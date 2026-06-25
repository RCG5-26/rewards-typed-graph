/**
 * Plan contracts for the agent console.
 *
 * `PlanResult` is a superset of the backend orchestrator's result
 * (`apps/api/src/orchestrator/contracts.ts` — `planId`, `planLineageId`,
 * `status`, `agentRunIds`) plus the materialized view the console renders
 * (steps + mutation log + traversal summary). Today those are produced
 * deterministically from the seed by `lib/plan/builder.ts`; when the real
 * orchestrator + `/mutations` SSE land (#3), the top-level orchestrator fields
 * come from `Orchestrator.run()` and the steps/mutations stream in — the shape
 * the console consumes stays the same.
 */

/** Mirrors the backend's specialist agents plus the orchestrator/graph actors. */
export type AgentType =
  | "orchestrator"
  | "wallet_agent"
  | "earning_agent"
  | "redemption_agent"
  | "system";

/** Mirrors the orchestrator's `UserGoalType`. */
export type GoalType =
  | "maximize_points"
  | "maximize_cashback"
  | "specific_redemption"
  | "minimize_fees";

/** Maps 1:1 to `plan_steps.status` lifecycle tokens. */
export type StepStatus = "proposed" | "current" | "stale" | "superseded";

/**
 * Plan revision lifecycle (maps 1:1 to `plans.status`, schema-final v3.1).
 * Replan flow: active `current` → `stale`; the replacement revision is
 * `generating` before it becomes `current`, and the prior revision ends
 * `superseded`. `failed` is terminal. Keeping the full set here means the
 * fixture→Postgres swap stays a wiring change, not a contract change.
 */
export type PlanStatus =
  | "generating"
  | "current"
  | "stale"
  | "superseded"
  | "failed";

export interface PlanStep {
  order: number;
  agentType: AgentType;
  /** "traverse_redemption", "assess_wallet", … — the typed operation kind. */
  type: string;
  title: string;
  reasoning: string;
  status: StepStatus;
  /** Node ids / step refs this step depends on (→ `state_dependencies`). */
  deps: string[];
}

/** One `graph_mutations` row, as the dark mutation log renders it. */
export interface MutationLogEntry {
  seq: number;
  agentType: AgentType;
  /** CREATE | READ | COMMIT | UPDATE | STALE | REPLAN — the typed write kind. */
  op: string;
  /** Target node label, e.g. "user_balances:chase_ur". */
  node: string;
  detail: string;
  /** Optimistic-concurrency version after the write (e.g. "v4"). */
  version: string;
  /** Graph node this write touches — lights it in the typed-graph view. */
  nodeId?: string;
}

// ── Typed-graph topology (the live node view) ──
export type GraphNodeKind = "program" | "redemption" | "plan";

export interface GraphNode {
  id: string;
  label: string;
  kind: GraphNodeKind;
  /** Layout column 0..n (source → dest → redemption). */
  col: number;
  /** Lifecycle: superseded nodes dim, stale nodes flag red. */
  state?: "active" | "stale" | "superseded";
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: "transfer" | "redeem";
  state?: "active" | "stale" | "superseded";
}

export interface PlanGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** What the console needs to render the request body. */
export interface PlanRequest {
  queryText: string;
  selectedCardIds: string[];
}

export interface PlanResult {
  // ── orchestrator-compatible header (placeholder ids until the real run) ──
  planId: string;
  planLineageId: string;
  status: PlanStatus;
  agentRunIds: string[];
  /** Plan revision number (1 = initial, 2 = after a replan). */
  revision: number;

  // ── materialized view ──
  goalType: GoalType;
  /** Short human label for the resolved goal, e.g. "specific redemption". */
  goalLabel: string;
  queryText: string;
  /** Traversal route summary, e.g. "Chase UR → Hyatt → Tokyo award". */
  route: string;
  /** Estimated plan value in cents (the redemption's resolved value). */
  planValueCents: number;
  /** Count of typed nodes touched (for the "N nodes live" chip). */
  liveNodes: number;
  steps: PlanStep[];
  mutations: MutationLogEntry[];
  graph: PlanGraph;
}

/** The invalidation that opens a replan (Hero Moment 1). */
export interface Invalidation {
  /** Graph edge/node that went stale. */
  staleEdgeId: string;
  staleNodeIds: string[];
  reason: string;
  /** The STALE mutation row to append to the log. */
  mutation: MutationLogEntry;
}

/** A replan: what was invalidated + the new current revision. */
export interface ReplanResult {
  invalidation: Invalidation;
  plan: PlanResult;
}
