/**
 * Types for the frozen Hono API contract.
 * Source of truth: docs/development/backend-local-setup.md
 */

export interface ApiPlanStep {
  order: number;
  type: string;
  summary: string;
  reasoning: string;
  status: string;
  dependsOn: string[];
  dependencies: ApiPlanDependency[];
}

export interface ApiPlanDependency {
  id: string;
  kind: string;
  table: string;
  slug: string;
  label: string;
  programId: string | null;
}

export interface ApiPlanGraphNode {
  id: string;
  kind: "program" | "redemption" | "plan";
  slug: string;
  label: string;
  programId: string | null;
}

export interface ApiPlanGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: "transfer" | "redeem";
}

export interface ApiPlanGraph {
  nodes: ApiPlanGraphNode[];
  edges: ApiPlanGraphEdge[];
}

export interface ApiPlan {
  planId: string;
  planLineageId: string;
  revisionNumber: number;
  status: string;
  query: string;
  summary: string;
  steps: ApiPlanStep[];
  graph: ApiPlanGraph;
}

export interface ApiBalanceTransferResponse {
  planLineageId: string;
  staledPlanId: string | null;
  replanJobId: string | null;
  currentPlan: ApiPlan;
}

export interface ApiSessionResponse {
  userId: string;
  clerkId: string;
  seeded: boolean;
}

export interface ApiTransferParams {
  sourceProgramId: string;
  destProgramId: string;
  amountPoints: number;
  idempotencyKey?: string;
}

/**
 * One event from the Hono /mutations/stream SSE (and /mutations REST list).
 * Mirrors apps/api/src/mutations/events.ts MutationEvent — kept in sync manually.
 */
export interface RealMutationEvent {
  event_id: string;
  mutation_type: string;
  target_table: string | null;
  target_node_id: string | null;
  plan_lineage_id: string | null;
  plan_id: string | null;
  summary: string;
}

export type ApiErrorKind =
  | { kind: "not-signed-in"; status: 401 }
  | { kind: "unprovisioned"; status: 403 }
  | { kind: "server-error"; status: number; message: string }
  | { kind: "misconfigured"; message: string };

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  constructor(kind: ApiErrorKind) {
    super(
      kind.kind === "misconfigured" || kind.kind === "server-error"
        ? kind.message
        : `API error: ${kind.status}`,
    );
    this.kind = kind;
  }
}
