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

/** One program balance the onboarding wallet picker submits to the API. */
export interface ApiBalanceInput {
  programId: string;
  points: number;
}

/**
 * Response from `POST /balances` — the server echoes the normalized per-program
 * balances it received so the client can confirm what was captured.
 */
export interface ApiSubmitBalancesResponse {
  userId: string;
  balances: ApiBalanceInput[];
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
  /**
   * Additional fields the Hono `MutationEvent` actually carries over the wire
   * (apps/api/src/mutations/events.ts) — the stream route forwards the full JSON.
   * Optional here because the legacy Python runtime leaves `agent_run_id` null;
   * it is populated only once the orchestrator (M4/M9) is mounted. Consumed by
   * `activity-adapter.ts`.
   */
  agent_run_id?: string | null;
  mutation_txn_id?: string;
  committed_at?: string;
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
