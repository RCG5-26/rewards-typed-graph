/**
 * View-model types for the demo-shell HTTP contract (spec 07).
 *
 * These are the shapes the Next.js shell consumes. They are deliberately a thin
 * projection of the graph (plans / plan_steps / state_dependencies) — the live
 * `mutation_type` log is the source of truth for the sidebar; this is the plan
 * the user reads. Keep these in sync with `fixtures/mock-plan.json`.
 */

export type PlanStatus = "generating" | "current" | "stale" | "superseded" | "failed";

export type PlanStepStatus = "proposed" | "current" | "stale" | "superseded";

export type PlanGraphNodeKind = "program" | "redemption" | "plan";

export type PlanGraphEdgeKind = "transfer" | "redeem";

export interface PlanDependencyView {
  id: string;
  kind: string;
  table: string;
  slug: string;
  label: string;
  programId: string | null;
}

export interface PlanGraphNodeView {
  id: string;
  kind: PlanGraphNodeKind;
  slug: string;
  label: string;
  programId: string | null;
}

export interface PlanGraphEdgeView {
  id: string;
  from: string;
  to: string;
  kind: PlanGraphEdgeKind;
}

export interface PlanGraphView {
  nodes: PlanGraphNodeView[];
  edges: PlanGraphEdgeView[];
}

export interface PlanStepView {
  order: number;
  type: string;
  summary: string;
  reasoning: string;
  status: PlanStepStatus;
  dependsOn: string[];
  dependencies: PlanDependencyView[];
}

export interface PlanView {
  planId: string;
  planLineageId: string;
  revisionNumber: number;
  status: PlanStatus;
  query: string;
  summary: string | null;
  steps: PlanStepView[];
  graph: PlanGraphView;
}

export interface SessionView {
  userId: string;
  clerkId: string | null;
  seeded: boolean;
}

/**
 * Caller identity for session bootstrap. Either an already-resolved `userId`
 * (existing user / dev bypass) or a Clerk `clerkId` that triggers an idempotent
 * persona clone on first login.
 */
export interface SessionIdentity {
  userId?: string;
  clerkId?: string;
  email?: string | null;
}

export interface BalanceTransferInput {
  sourceProgramId: string;
  destProgramId: string;
  amountPoints: number;
  /** Optional client key so retries replay the same graph-write transaction. */
  idempotencyKey?: string;
}

export interface BalanceTransferResult {
  planLineageId: string;
  staledPlanId: string | null;
  replanJobId: string | null;
  currentPlan: PlanView;
}
