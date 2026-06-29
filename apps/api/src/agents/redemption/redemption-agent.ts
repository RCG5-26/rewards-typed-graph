/**
 * M2 — Deterministic Redemption specialist adapter.
 *
 * Evaluates whether the demo user's Hyatt balance meets the minimum for
 * redemption option f001 (Hyatt Ginza 3-night, min 45k pts), then emits one or
 * two (CreatePlanStep + RecordStateDependency) pairs. The dependency is the
 * structural-stale anchor (thesis claim 8/9/10).
 *
 * Branch + state-dependency selection (demo fixture §3, orchestrator-thesis-contracts):
 *  - Hyatt ≥ threshold → direct redemption → one step, depend on **Hyatt**
 *    (stale if Hyatt drops below minimum).
 *  - Hyatt < threshold but Chase+Hyatt ≥ threshold → **complete two-step plan**:
 *    transfer (depends on **Chase UR**, the funding source) + the redemption it
 *    unlocks (depends on **Hyatt**). Executing the transfer bumps both versions,
 *    staling the plan and enqueuing exactly one replan job (one job per stale
 *    plan, deduped by `replan_jobs.source_plan_id`). Emitting the redemption now
 *    makes rev1 a complete, goal-satisfying plan comparable to one-shot baselines.
 *
 * Ownership: redemption_agent is the SOLE owner of RecordStateDependency
 * (agents/ownership.ts). No other specialist can write this mutation.
 *
 * Note on planStepId: CommitSuccess.mutationTxnId is used as the planStepId
 * for the subsequent RecordStateDependency call. The production bridge command
 * (orchestrator-commit-step) returns plan_steps.id as mutationTxnId so the
 * agent can reference the newly created step. See contract drift note in
 * final handoff.
 *
 * No LLM, no DB access, no network. Demo fixture constants are hard-coded per
 * ADR 0010 §5 ("Specialists remain deterministic for this milestone").
 */

import type { Agent, AgentContext, GraphSnapshot, UserBalanceRow } from "../contracts";
import { CommitFailure } from "../contracts";
import type { RedemptionTraversalOperation } from "../../orchestrator/contracts";

// ──────────────────────────────────────────────
// Demo fixture constants (demo-seed-v1)
// ──────────────────────────────────────────────

const HYATT_PROGRAM_ID = "00000000-0000-0000-0000-00000000b002";
const HYATT_REDEMPTION_OPTION_ID = "00000000-0000-0000-0000-00000000f001";
const HYATT_MIN_POINTS = 45_000;

const CHASE_UR_PROGRAM_ID = "00000000-0000-0000-0000-00000000b001";

const GINZA_AWARD_NAME = "Demo Hyatt Ginza 3-night Tokyo award";

// This deterministic milestone adapter only models the Hyatt demo option funded
// by Hyatt or Chase UR (ADR 0010 §5). Any operation outside this set is rejected
// rather than silently rewritten into a Hyatt/Chase plan.
const SUPPORTED_SOURCE_PROGRAM_IDS = new Set([HYATT_PROGRAM_ID, CHASE_UR_PROGRAM_ID]);

export class RedemptionAgent implements Agent<"redemption_agent"> {
  readonly agentType = "redemption_agent" as const;

  async run(context: AgentContext<"redemption_agent">): Promise<void> {
    const { operation, snapshot, commit, planId } = context;

    validateOperation(operation);

    const hyattBalance = findBalance(snapshot, HYATT_PROGRAM_ID);
    const chaseBalance = findBalance(snapshot, CHASE_UR_PROGRAM_ID);

    if (hyattBalance === null) {
      throw new CommitFailure(
        "ValidationError",
        "Redemption agent requires a Hyatt balance in the snapshot",
      );
    }

    if (hyattBalance.balancePoints >= HYATT_MIN_POINTS) {
      // Direct redemption — Hyatt balance meets minimum threshold.
      // Depend on Hyatt: if Hyatt drops below threshold, this step is stale.
      const stepResult = await commit({
        mutation: {
          kind: "CreatePlanStep",
          planId,
          stepOrder: 1,
          stepType: "redemption_recommendation",
          payload: {
            redemptionOptionId: HYATT_REDEMPTION_OPTION_ID,
            sourceProgramId: HYATT_PROGRAM_ID,
            action: redemptionAction(),
            reasoning:
              "Hyatt balance already meets the 45,000-point minimum for the Ginza award.",
          },
        },
        // Direct redemption depends on Hyatt alone. Including Chase here would let
        // an unrelated Chase version bump fail an otherwise-valid step.
        readSet: { [hyattBalance.id]: hyattBalance.version },
        idempotencyKey: `redemption-direct:${planId}:${HYATT_REDEMPTION_OPTION_ID}`,
      });

      await commit({
        mutation: {
          kind: "RecordStateDependency",
          planStepId: stepResult.mutationTxnId,
          targetNodeId: hyattBalance.id,
          observedVersion: hyattBalance.version,
          target: {
            targetNodeType: "UserBalance",
            targetTable: "user_balances",
            dependedProperty: "balance_points",
            snapshotValue: { balancePoints: hyattBalance.balancePoints },
          },
        },
        readSet: { [hyattBalance.id]: hyattBalance.version },
        idempotencyKey: `redemption-dep:${planId}:hyatt:${hyattBalance.id}`,
      });

      return;
    }

    if (
      chaseBalance !== null &&
      chaseBalance.balancePoints + hyattBalance.balancePoints >= HYATT_MIN_POINTS
    ) {
      // Transfer-first path: Hyatt is short, but Chase UR can fund the gap.
      // Emit a COMPLETE rev1 plan — transfer (step 1) AND the redemption it
      // unlocks (step 2) — so the plan is directly comparable to one-shot
      // baselines and goal-satisfying immediately, while still driving the
      // reactive replan: each step records a balance dependency, so executing
      // the transfer (which bumps both Chase and Hyatt versions) stales the
      // plan and enqueues a single replan job.

      // Step 1 — transfer. Depend on Chase UR (the funding source).
      const deficit = transferDeficit(hyattBalance.balancePoints);
      const transferStep = await commit({
        mutation: {
          kind: "CreatePlanStep",
          planId,
          stepOrder: 1,
          stepType: "transfer_recommendation",
          payload: {
            fromProgramId: CHASE_UR_PROGRAM_ID,
            toProgramId: HYATT_PROGRAM_ID,
            action: transferAction(deficit),
            reasoning: transferReasoning(hyattBalance.balancePoints, deficit),
          },
        },
        readSet: buildReadSet(hyattBalance, chaseBalance),
        idempotencyKey: `redemption-transfer:${planId}:${CHASE_UR_PROGRAM_ID}`,
      });

      await commit({
        mutation: {
          kind: "RecordStateDependency",
          planStepId: transferStep.mutationTxnId,
          targetNodeId: chaseBalance.id,
          observedVersion: chaseBalance.version,
          target: {
            targetNodeType: "UserBalance",
            targetTable: "user_balances",
            dependedProperty: "balance_points",
            snapshotValue: { balancePoints: chaseBalance.balancePoints },
          },
        },
        readSet: { [chaseBalance.id]: chaseBalance.version },
        idempotencyKey: `redemption-dep:${planId}:chase:${chaseBalance.id}`,
      });

      // Step 2 — the redemption the transfer funds. Depend on Hyatt (the
      // redeeming program), consistent with the direct-redemption branch.
      const redemptionStep = await commit({
        mutation: {
          kind: "CreatePlanStep",
          planId,
          stepOrder: 2,
          stepType: "redemption_recommendation",
          payload: {
            redemptionOptionId: HYATT_REDEMPTION_OPTION_ID,
            sourceProgramId: HYATT_PROGRAM_ID,
            action: redemptionAction(),
            reasoning:
              "After the Chase transfer, redeem the best-value Tokyo hotel award.",
          },
        },
        readSet: { [hyattBalance.id]: hyattBalance.version },
        idempotencyKey: `redemption-after-transfer:${planId}:${HYATT_REDEMPTION_OPTION_ID}`,
      });

      await commit({
        mutation: {
          kind: "RecordStateDependency",
          planStepId: redemptionStep.mutationTxnId,
          targetNodeId: hyattBalance.id,
          observedVersion: hyattBalance.version,
          target: {
            targetNodeType: "UserBalance",
            targetTable: "user_balances",
            dependedProperty: "balance_points",
            snapshotValue: { balancePoints: hyattBalance.balancePoints },
          },
        },
        readSet: { [hyattBalance.id]: hyattBalance.version },
        idempotencyKey: `redemption-dep:${planId}:hyatt-after-transfer:${hyattBalance.id}`,
      });

      return;
    }

    // Insufficient points — no path to redemption. Record what we observed.
    const stepResult = await commit({
      mutation: {
        kind: "CreatePlanStep",
        planId,
        stepOrder: 1,
        stepType: "redemption_recommendation",
        payload: {
          redemptionOptionId: HYATT_REDEMPTION_OPTION_ID,
          sourceProgramId: HYATT_PROGRAM_ID,
          action: redemptionAction(),
          reasoning: insufficientReasoning(
            hyattBalance.balancePoints,
            chaseBalance?.balancePoints ?? 0,
          ),
        },
      },
      // Insufficient-points path depends on Hyatt alone (the dependency edge below
      // anchors on Hyatt); keep Chase out of the read-set to avoid spurious staleness.
      readSet: { [hyattBalance.id]: hyattBalance.version },
      idempotencyKey: `redemption-insufficient:${planId}:${HYATT_REDEMPTION_OPTION_ID}`,
    });

    await commit({
      mutation: {
        kind: "RecordStateDependency",
        planStepId: stepResult.mutationTxnId,
        targetNodeId: hyattBalance.id,
        observedVersion: hyattBalance.version,
        target: {
          targetNodeType: "UserBalance",
          targetTable: "user_balances",
          dependedProperty: "balance_points",
          snapshotValue: { balancePoints: hyattBalance.balancePoints },
        },
      },
      readSet: { [hyattBalance.id]: hyattBalance.version },
      idempotencyKey: `redemption-dep:${planId}:hyatt-insuf:${hyattBalance.id}`,
    });
  }
}

function validateOperation(op: RedemptionTraversalOperation): void {
  if (!Array.isArray(op.sourceProgramIds) || op.sourceProgramIds.length === 0) {
    throw new CommitFailure(
      "ValidationError",
      "RedemptionTraversalOperation requires at least one sourceProgramId",
    );
  }

  // A non-null target that is not the demo option would otherwise be silently
  // rewritten to the Hyatt payload — fail fast instead. (null is allowed: the
  // demo goal may not have a resolved option, and the adapter targets Hyatt.)
  if (
    op.targetRedemptionOptionId !== null &&
    op.targetRedemptionOptionId !== HYATT_REDEMPTION_OPTION_ID
  ) {
    throw new CommitFailure(
      "ValidationError",
      `redemption adapter only supports demo option ${HYATT_REDEMPTION_OPTION_ID}; ` +
        `got ${op.targetRedemptionOptionId}`,
    );
  }

  const unsupported = op.sourceProgramIds.filter(
    (id) => !SUPPORTED_SOURCE_PROGRAM_IDS.has(id),
  );
  if (unsupported.length > 0) {
    throw new CommitFailure(
      "ValidationError",
      `redemption adapter only supports Hyatt/Chase demo source programs; ` +
        `got unsupported: ${unsupported.join(", ")}`,
    );
  }
}

function findBalance(
  snapshot: GraphSnapshot,
  programId: string,
): UserBalanceRow | null {
  return snapshot.userBalances.find((b) => b.programId === programId) ?? null;
}

function buildReadSet(
  hyattBalance: UserBalanceRow,
  chaseBalance: UserBalanceRow | null,
): Record<string, number> {
  const readSet: Record<string, number> = {
    [hyattBalance.id]: hyattBalance.version,
  };
  if (chaseBalance !== null) {
    readSet[chaseBalance.id] = chaseBalance.version;
  }
  return readSet;
}

function formatPoints(points: number): string {
  return points.toLocaleString("en-US");
}

function transferDeficit(hyattPoints: number): number {
  return Math.max(0, HYATT_MIN_POINTS - hyattPoints);
}

function transferAction(deficit: number): string {
  return `Transfer ${formatPoints(deficit)} Chase Ultimate Rewards points to World of Hyatt.`;
}

function transferReasoning(hyattPoints: number, deficit: number): string {
  return (
    `Hyatt holds ${formatPoints(hyattPoints)} but ${GINZA_AWARD_NAME} requires ` +
    `${formatPoints(HYATT_MIN_POINTS)}; Chase UR can fund the ${formatPoints(deficit)} gap at 1:1.`
  );
}

function redemptionAction(): string {
  return `Book ${GINZA_AWARD_NAME} for ${formatPoints(HYATT_MIN_POINTS)} Hyatt points.`;
}

function insufficientReasoning(hyattPoints: number, chasePoints: number): string {
  return (
    `Combined Hyatt and Chase balances (${formatPoints(hyattPoints + chasePoints)}) are below ` +
    `the ${formatPoints(HYATT_MIN_POINTS)}-point award minimum.`
  );
}
