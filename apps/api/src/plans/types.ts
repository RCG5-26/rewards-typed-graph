/**
 * View-model types for the demo-shell HTTP contract (spec 07).
 *
 * These are the shapes the Next.js shell consumes. They are deliberately a thin
 * projection of the graph (plans / plan_steps / state_dependencies) — the live
 * `mutation_type` log is the source of truth for the sidebar; this is the plan
 * the user reads. Keep these in sync with `fixtures/mock-plan.json`.
 */

export type PlanStatus =
  | "generating"
  | "current"
  | "stale"
  | "superseded"
  | "failed";

export type PlanStepStatus = "proposed" | "current" | "stale" | "superseded";

export interface PlanStepView {
  order: number;
  type: string;
  summary: string;
  reasoning: string;
  status: PlanStepStatus;
  dependsOn: string[];
}

export interface PlanView {
  planId: string;
  planLineageId: string;
  revisionNumber: number;
  status: PlanStatus;
  query: string;
  summary: string | null;
  steps: PlanStepView[];
}

export interface SessionView {
  userId: string;
  clerkId: string | null;
  seeded: boolean;
}

export interface BalanceTransferInput {
  sourceProgramId: string;
  destProgramId: string;
  amountPoints: number;
}

export interface BalanceTransferResult {
  planLineageId: string;
  staledPlanId: string | null;
  replanJobId: string | null;
  currentPlan: PlanView;
}
