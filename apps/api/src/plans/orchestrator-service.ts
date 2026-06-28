import type { PlanProjectionPort, PlanRequest, PlanResult } from "../orchestrator/contracts";
import { PlanServiceError, type PlanService } from "./service";
import type {
  BalanceTransferInput,
  BalanceTransferResult,
  PlanView,
  SessionIdentity,
  SessionView,
} from "./types";

/**
 * The orchestrator core as the Plan service sees it: a structural slice of
 * `Orchestrator` (`orchestrator/orchestrator.ts`). Injected so M6 stays
 * decoupled from how the orchestrator is assembled (composition root) and
 * remains unit-testable with a double.
 */
export interface OrchestratorRunner {
  run(request: PlanRequest): Promise<PlanResult>;
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

  async transferBalance(
    userId: string,
    input: BalanceTransferInput,
  ): Promise<BalanceTransferResult> {
    return this.deps.readDelegate.transferBalance(userId, input);
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
