import type {
  PlanProjectionPort,
  PlanRequest,
  PlanResult,
  RevisionResult,
  RevisionSpec,
} from "../orchestrator/contracts";
import { PlanServiceError, type PlanService } from "./service";
import type {
  BalanceTransferInput,
  BalanceTransferResult,
  PlanView,
  SessionIdentity,
  SessionView,
} from "./types";

/** Stable worker identity for the synchronous TS orchestrator replan path. */
const REPLAN_WORKER_ID = "orchestrator-ts-replan-worker";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The orchestrator core as the Plan service sees it: a structural slice of
 * `Orchestrator` (`orchestrator/orchestrator.ts`). Injected so M6 stays
 * decoupled from how the orchestrator is assembled (composition root) and
 * remains unit-testable with a double.
 */
export interface OrchestratorRunner {
  run(request: PlanRequest): Promise<PlanResult>;
  /**
   * Replan re-entry: build a revision in an existing lineage. On success the
   * revision is left 'generating' — the replan-job promotion finalizes it.
   */
  runRevision(request: PlanRequest, revision: RevisionSpec): Promise<RevisionResult>;
}

/** Outcome of applying the canonical transfer mutation (no revision generated). */
export interface ReplanApplyOutcome {
  readonly planLineageId: string;
  readonly staledPlanId: string;
  /** null when idempotencyReplayed=true — no new replan job was created */
  readonly replanJobId: string | null;
  /** Explicit signal from the persistence layer: same transfer replayed, balances unchanged */
  readonly idempotencyReplayed: boolean;
  readonly priorQueryText: string;
  readonly priorRevisionNumber: number;
}

/**
 * Replan lifecycle over the controlled Python write boundary: apply the
 * canonical mutation (no generation), then promote or fail the replan job once
 * the TS orchestrator has built the revision. NEVER the legacy Python plan
 * generator — generation always re-enters the orchestrator.
 */
export interface ReplanPort {
  applyTransfer(userId: string, input: BalanceTransferInput): Promise<ReplanApplyOutcome>;
  promote(input: {
    userId: string;
    planLineageId: string;
    sourcePlanId: string;
    resultPlanId: string;
    workerId: string;
  }): Promise<void>;
  fail(input: {
    userId: string;
    planLineageId: string;
    sourcePlanId: string;
    workerId: string;
    resultPlanId?: string;
    error: string;
  }): Promise<void>;
}

/**
 * Engine-agnostic read/session delegate (Contract 1). These methods are not
 * owned by the orchestrator engine: `getSession`/`resetDemo` are persona
 * bootstrap, `getCurrentPlan` is a projection read, and `transferBalance` is the
 * replan trigger that Phase 8 will re-route through orchestrator re-entry. They
 * reuse the existing projection regardless of engine — they are NEVER the
 * plan-generation fallback for `createPlan`.
 */
export interface OrchestratorReadDelegate {
  getSession(identity: SessionIdentity): Promise<SessionView>;
  resetDemo(userId: string): Promise<SessionView>;
  getCurrentPlan(userId: string, lineageId: string): Promise<PlanView | null>;
  transferBalance(userId: string, input: BalanceTransferInput): Promise<BalanceTransferResult>;
}

export interface OrchestratorPlanServiceDeps {
  readonly orchestrator: OrchestratorRunner;
  readonly projection: PlanProjectionPort;
  readonly readDelegate: OrchestratorReadDelegate;
  /** Replan lifecycle (apply mutation / promote / fail) — orchestrator re-entry. */
  readonly replan: ReplanPort;
}

/**
 * Internal failure for orchestrator-mode `createPlan` that is intentionally NOT
 * a `PlanServiceError` (whose codes map to 4xx). It surfaces as a 500-class
 * error in `routes.ts` — a failed orchestration or a malformed projection is an
 * internal error, never a silent empty plan and never a legacy retry.
 */
export class OrchestratorPlanError extends Error {
  constructor(
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "OrchestratorPlanError";
  }
}

/**
 * M6 — the orchestrator `PlanService` implementation (Contracts 1 + 7).
 *
 * `createPlan` drives the mounted `Orchestrator`, then re-projects the persisted
 * plan into the canonical `PlanView` via {@link PlanProjectionPort}. There is no
 * fallback: an orchestrator failure or a missing/invalid projection throws a
 * typed error (mapped to 500) — the bridge is never invoked to "rescue" the
 * request (ADR 0010 §8).
 */
export class OrchestratorPlanService implements PlanService {
  constructor(private readonly deps: OrchestratorPlanServiceDeps) {}

  async getSession(identity: SessionIdentity): Promise<SessionView> {
    return this.deps.readDelegate.getSession(identity);
  }

  async resetDemo(userId: string): Promise<SessionView> {
    return this.deps.readDelegate.resetDemo(userId);
  }

  /**
   * Generate a plan through the orchestrator, then project it back from
   * PostgreSQL. `cardSlugs` is part of the frozen public request but is not
   * carried by the frozen `PlanRequest` ({userId, queryText}); the deterministic
   * decomposer derives invocations from the query text. Wiring card context
   * into the request is a Phase 6 concern, not a C1 one.
   */
  async createPlan(userId: string, query: string, _cardSlugs?: string[]): Promise<PlanView> {
    const result = await this.deps.orchestrator.run({ userId, queryText: query });

    if (result.status === "failed") {
      throw new OrchestratorPlanError("orchestrator failed to build the plan", {
        planId: result.planId,
        planLineageId: result.planLineageId,
        agentRunIds: result.agentRunIds,
      });
    }

    const view = await this.deps.projection.project(result.planId, userId);
    if (!view) {
      throw new OrchestratorPlanError("plan committed but projection returned no view", {
        planId: result.planId,
      });
    }
    assertValidPlanView(view);
    return view;
  }

  async getPlanById(userId: string, planId: string): Promise<PlanView | null> {
    const view = await this.deps.projection.project(planId, userId);
    // null = not found (a valid 404). A present-but-malformed projection is the
    // same internal error as in createPlan — surface it, don't leak it to callers.
    if (view) {
      assertValidPlanView(view);
    }
    return view;
  }

  async getCurrentPlan(userId: string, lineageId: string): Promise<PlanView | null> {
    return this.deps.readDelegate.getCurrentPlan(userId, lineageId);
  }

  /**
   * Orchestrator-mode replan (Phase 8). The transfer is the replan trigger, but
   * unlike the legacy path it does NOT delegate revision generation to Python:
   *
   *   apply canonical mutation (stale rev1 + enqueue job)
   *     → re-enter the TS orchestrator to build revision 2 (fresh AgentRuns)
   *     → promote the replan job (rev2 current, rev1 superseded, job completed)
   *
   * A failure anywhere stays visible: the replan job is failed, the partial
   * revision is marked failed, and rev1 remains stale — never a silent fallback.
   */
  async transferBalance(
    userId: string,
    input: BalanceTransferInput,
  ): Promise<BalanceTransferResult> {
    const applied = await this.deps.replan.applyTransfer(userId, input);

    // Short-circuit: same transfer replayed — balances unchanged, no new job created.
    // Return the existing current plan without attempting another revision.
    if (applied.idempotencyReplayed) {
      const existing = await this.deps.readDelegate.getCurrentPlan(userId, applied.planLineageId);
      if (!existing) {
        throw new OrchestratorPlanError("idempotency replay: no current plan found in lineage", {
          planLineageId: applied.planLineageId,
        });
      }
      return {
        planLineageId: applied.planLineageId,
        staledPlanId: applied.staledPlanId,
        replanJobId: applied.replanJobId,
        currentPlan: existing,
      };
    }

    const currentPlan = await this.createRevisedPlan({
      userId,
      query: applied.priorQueryText,
      sourcePlanId: applied.staledPlanId,
      lineageId: applied.planLineageId,
      revisionNumber: applied.priorRevisionNumber + 1,
      replanJobId: applied.replanJobId,
    });

    return {
      planLineageId: applied.planLineageId,
      staledPlanId: applied.staledPlanId,
      replanJobId: applied.replanJobId,
      currentPlan,
    };
  }

  /**
   * Build revision 2 through the orchestrator (fresh PostgreSQL snapshot →
   * Wallet → Redemption → dependencies + AgentRuns), then promote it. The
   * revision is created in the EXISTING lineage (never `createPlan`, which would
   * fork a new lineage). Revision 1 is superseded only on success.
   */
  async createRevisedPlan(params: {
    userId: string;
    query: string;
    sourcePlanId: string;
    lineageId: string;
    revisionNumber: number;
    replanJobId: string | null;
  }): Promise<PlanView> {
    let revision: RevisionResult | undefined;
    try {
      revision = await this.deps.orchestrator.runRevision(
        { userId: params.userId, queryText: params.query },
        {
          planLineageId: params.lineageId,
          revisionNumber: params.revisionNumber,
          supersedesPlanId: params.sourcePlanId,
        },
      );

      if (revision.status === "failed") {
        throw new OrchestratorPlanError("orchestrator failed to build the revised plan", {
          planId: revision.planId,
          planLineageId: revision.planLineageId,
          revisionNumber: revision.revisionNumber,
          agentRunIds: revision.agentRunIds,
        });
      }

      await this.deps.replan.promote({
        userId: params.userId,
        planLineageId: params.lineageId,
        sourcePlanId: params.sourcePlanId,
        resultPlanId: revision.planId,
        workerId: REPLAN_WORKER_ID,
      });
    } catch (err) {
      await this.failReplanQuietly({
        userId: params.userId,
        planLineageId: params.lineageId,
        sourcePlanId: params.sourcePlanId,
        resultPlanId: revision?.planId,
        error: errorMessage(err),
      });
      throw err;
    }

    const view = await this.deps.projection.project(revision.planId, params.userId);
    if (!view) {
      throw new OrchestratorPlanError("revised plan committed but projection returned no view", {
        planId: revision.planId,
      });
    }
    assertValidPlanView(view);
    return view;
  }

  /**
   * Fail the replan job without masking the original error. A failure during
   * failure-handling is swallowed (the original throw is what matters); rev1
   * stays stale either way, so the failed replan remains visible.
   */
  private async failReplanQuietly(input: {
    userId: string;
    planLineageId: string;
    sourcePlanId: string;
    resultPlanId?: string;
    error: string;
  }): Promise<void> {
    try {
      await this.deps.replan.fail({ ...input, workerId: REPLAN_WORKER_ID });
    } catch {
      // Intentionally swallowed: the source plan is already stale, so the
      // incomplete replan is observable regardless of cleanup success.
    }
  }
}

/**
 * Runtime validation of a projected `PlanView` (Contract 7). A malformed
 * projection is a 500-class internal error, not a silent empty plan.
 */
function assertValidPlanView(view: PlanView): void {
  const missing: string[] = [];
  if (!view.planId) missing.push("planId");
  if (!view.planLineageId) missing.push("planLineageId");
  if (!view.status) missing.push("status");
  if (!Array.isArray(view.steps)) missing.push("steps");
  if (missing.length > 0) {
    throw new OrchestratorPlanError(
      `projected PlanView is missing required fields: ${missing.join(", ")}`,
    );
  }
}
