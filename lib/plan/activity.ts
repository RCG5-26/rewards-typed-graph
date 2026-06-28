/**
 * Frontend-only typed model for the orchestration-evidence trace the compact
 * `AgentActivity` panel renders.
 *
 * This is the demo-observability contract — a presentation projection, not a
 * new backend contract. Every field maps to something the orchestrator runtime
 * already produces (see `apps/api/src/orchestrator/contracts.ts` and
 * `apps/api/src/agents/contracts.ts`):
 *
 *   - `runId`          → `agent_runs.id`         (AgentRunRecord.id)
 *   - `specialist`     → `agent_runs.agent_type` (AgentType)
 *   - `operation`      → the typed AgentOperation `kind`
 *   - `commit`         → CommitSuccess / CommitFailure.kind
 *   - `revision` etc.  → `plans.revision_number` + `plans.status` transitions
 *
 * Fields the *current* frozen event contract (`RealMutationEvent`) does NOT
 * carry — `snapshotVersion`, `validation`, `startedAt`/`endedAt` — are all
 * optional here on purpose. The adapter leaves them `undefined` rather than
 * fabricating values; the panel degrades gracefully when they are absent.
 * See `lib/api/activity-adapter.ts` for what is and isn't derivable today.
 */

import type { AgentType } from "./types";

/** Lifecycle of a single activity row, independent of the design-system color. */
export type ActivityStatus = "pending" | "running" | "succeeded" | "failed";

/** Mirrors the backend's `CommitFailureKind` (agents/contracts.ts). */
export type CommitFailureClass =
  | "ValidationError"
  | "OwnershipError"
  | "ConflictError"
  | "IdempotencyConflict"
  | "UnexpectedCommitError";

/** The controlled mutation-boundary outcome for a specialist's write. */
export type CommitOutcome =
  | { readonly result: "committed"; readonly mutationTxnId: string; readonly idempotencyReplayed?: boolean }
  | { readonly result: "failed"; readonly failureClass: CommitFailureClass };

/** Whether the specialist's result passed orchestrator validation. */
export type ValidationResult = "passed" | "failed" | "not_run";

/**
 * One specialist execution against a constrained graph snapshot — e.g.
 * "Wallet · InspectWallet · Snapshot: wallet-state-v1".
 */
export interface SpecialistRunEntry {
  readonly kind: "specialist_run";
  /** `agent_runs.id` — stable, used as the React key and SR description. */
  readonly runId: string;
  readonly specialist: AgentType;
  /** Typed operation kind, e.g. "assess_wallet" / "traverse_redemption". */
  readonly operation: string;
  /** Human label for the operation, e.g. "InspectWallet". */
  readonly operationLabel?: string;
  readonly status: ActivityStatus;
  /** Constrained snapshot/state version read, e.g. "wallet-state-v1". */
  readonly snapshotVersion?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly validation?: ValidationResult;
  readonly commit?: CommitOutcome;
  /** Free-text evidence line, e.g. "Dependency recorded: Chase UR balance". */
  readonly detail?: string;
}

/** A Plan-revision lifecycle transition, e.g. "Plan revision 1 committed". */
export type PlanTransition = "committed" | "promoted" | "stale" | "superseded" | "failed";

export interface PlanLifecycleEntry {
  readonly kind: "plan_lifecycle";
  /** `plans.revision_number` the transition applies to. */
  readonly revision: number;
  readonly transition: PlanTransition;
  readonly status: ActivityStatus;
  /** What triggered it, e.g. "Chase UR balance changed". */
  readonly reason?: string;
  readonly detail?: string;
}

export type ActivityEntry = SpecialistRunEntry | PlanLifecycleEntry;

export interface AgentActivityTrace {
  /** `plans.plan_lineage_id` this trace belongs to. */
  readonly planLineageId: string;
  /** Ordered oldest → newest; index conveys operation order. */
  readonly entries: readonly ActivityEntry[];
}

/** Load state of the trace source, decoupled from the trace contents. */
export type ActivityPhase = "loading" | "ready" | "error";

/** Short, capitalized label for a specialist actor. */
export function specialistLabel(agent: AgentType): string {
  switch (agent) {
    case "wallet_agent":
      return "Wallet";
    case "earning_agent":
      return "Earning";
    case "redemption_agent":
      return "Redemption";
    case "orchestrator":
      return "Orchestrator";
    case "system":
      return "Graph";
  }
}
