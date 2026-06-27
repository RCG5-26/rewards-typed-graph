/**
 * M2 — Deterministic Redemption specialist adapter.
 *
 * Evaluates whether the demo user's Hyatt balance meets the minimum for
 * redemption option f001 (Hyatt Ginza 3-night, min 45k pts), then emits:
 *  1. CreatePlanStep  (redemption_recommendation OR transfer_recommendation)
 *  2. RecordStateDependency  (structural-stale anchor, thesis claim 8/9/10)
 *
 * State-dependency target selection (demo fixture §3, orchestrator-thesis-contracts):
 *  - Hyatt ≥ threshold → direct redemption → depend on **Hyatt** balance
 *    (stale if Hyatt drops below minimum)
 *  - Hyatt < threshold but Chase+Hyatt ≥ threshold → transfer recommendation →
 *    depend on **Chase UR** balance (the funding source; stale when Chase bumps
 *    version, which is exactly what transfer_points() does)
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
          },
        },
        readSet: buildReadSet(hyattBalance, chaseBalance),
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
      // Transfer from Chase UR → Hyatt, then redeem.
      // Depend on Chase UR: the funding source. When transfer_points() bumps the
      // Chase UR version, this dependency triggers structural invalidation of the
      // step, causing the plan to go stale and a replan job to be enqueued.
      const stepResult = await commit({
        mutation: {
          kind: "CreatePlanStep",
          planId,
          stepOrder: 1,
          stepType: "transfer_recommendation",
          payload: {
            fromProgramId: CHASE_UR_PROGRAM_ID,
            toProgramId: HYATT_PROGRAM_ID,
          },
        },
        readSet: buildReadSet(hyattBalance, chaseBalance),
        idempotencyKey: `redemption-transfer:${planId}:${CHASE_UR_PROGRAM_ID}`,
      });

      await commit({
        mutation: {
          kind: "RecordStateDependency",
          planStepId: stepResult.mutationTxnId,
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
        },
      },
      readSet: buildReadSet(hyattBalance, chaseBalance),
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
