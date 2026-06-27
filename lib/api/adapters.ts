/**
 * Pure adapter functions mapping Hono API response shapes to frontend view models.
 * No I/O; fully unit-testable against captured API fixtures.
 *
 * The web tier is database-less (KTD-5), so traversal topology comes from the
 * API's typed graph projection instead of resolving database UUIDs in-browser.
 */

import { deriveGoalType } from "@/lib/plan/builder";
import { buildTraversalChain } from "@/lib/plan/graph-traversal";
import type {
  AgentType,
  GraphEdge,
  GraphNode,
  GraphNodeKind,
  Invalidation,
  MutationLogEntry,
  PlanResult,
  PlanStep,
} from "@/lib/plan/types";
import type { ApiPlan, ApiSessionResponse, ApiTransferParams } from "./types";
import { ApiError } from "./types";

/** The scripted demo transfer params for the seeded persona. */
const DEMO_TRANSFER: ApiTransferParams = {
  sourceProgramId: "00000000-0000-0000-0000-00000000b001",
  destProgramId: "00000000-0000-0000-0000-00000000b002",
  amountPoints: 30000,
};

const STEP_TYPE_TO_AGENT: Record<string, AgentType> = {
  spend_analysis: "wallet_agent",
  transfer_recommendation: "redemption_agent",
  redemption_recommendation: "redemption_agent",
  decompose_query: "orchestrator",
};

function agentTypeForStep(type: string): AgentType {
  return STEP_TYPE_TO_AGENT[type] ?? "orchestrator";
}

function buildGraph(apiPlan: ApiPlan): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const apiGraph = apiPlan.graph ?? { nodes: [], edges: [] };
  const colByNode = new Map<string, number>();

  for (const edge of apiGraph.edges) {
    if (edge.kind === "transfer") {
      colByNode.set(edge.from, Math.min(colByNode.get(edge.from) ?? 0, 0));
      colByNode.set(edge.to, Math.max(colByNode.get(edge.to) ?? 0, 1));
    } else {
      colByNode.set(edge.from, Math.max(colByNode.get(edge.from) ?? 0, 1));
      colByNode.set(edge.to, Math.max(colByNode.get(edge.to) ?? 0, 2));
    }
  }

  const nodes: GraphNode[] = apiGraph.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    kind: normalizeNodeKind(node.kind),
    col: colByNode.get(node.id) ?? (node.kind === "redemption" ? 2 : 0),
    state: "active",
  }));

  const edges: GraphEdge[] = apiGraph.edges.map((edge) => ({
    id: edge.id,
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    state: "active",
  }));

  return { nodes, edges };
}

function normalizeNodeKind(kind: string): GraphNodeKind {
  return kind === "redemption" || kind === "plan" ? kind : "program";
}

function deriveRoute(apiPlan: ApiPlan): string {
  const transferStep = apiPlan.steps.find((s) => s.type === "transfer_recommendation");
  if (transferStep) {
    return transferStep.summary;
  }
  const redeemStep = apiPlan.steps.find((s) => s.type === "redemption_recommendation");
  return redeemStep?.summary ?? apiPlan.summary ?? "";
}

/** Maps a live Hono API plan body to the frontend PlanResult view model. */
export function toPlanResult(apiPlan: ApiPlan): PlanResult {
  const goalType = deriveGoalType(apiPlan.query);
  const GOAL_LABELS: Record<string, string> = {
    maximize_points: "maximize points",
    maximize_cashback: "maximize cashback",
    specific_redemption: "specific redemption",
    minimize_fees: "minimize fees",
  };
  const { nodes, edges } = buildGraph(apiPlan);

  const steps: PlanStep[] = apiPlan.steps.map((s) => ({
    order: s.order,
    agentType: agentTypeForStep(s.type),
    type: s.type,
    title: s.summary,
    reasoning: s.reasoning,
    status: s.status as PlanStep["status"],
    deps: s.dependsOn,
    dependencies: s.dependencies?.map((d) => ({
      id: d.id,
      kind: d.kind,
      slug: d.slug,
      label: d.label,
    })),
  }));

  return {
    planId: apiPlan.planId,
    planLineageId: apiPlan.planLineageId,
    status: apiPlan.status as PlanResult["status"],
    agentRunIds: [],
    revision: apiPlan.revisionNumber,
    goalType,
    goalLabel: GOAL_LABELS[goalType] ?? goalType,
    queryText: apiPlan.query,
    route: deriveRoute(apiPlan),
    planValueCents: 0,
    liveNodes: nodes.length,
    steps,
    mutations: toMutationRows(apiPlan),
    graph: { nodes, edges },
  };
}

/** Generates a synthetic mutation log from API plan steps for SSE re-pacing. */
export function toMutationRows(apiPlan: ApiPlan): MutationLogEntry[] {
  const rows: MutationLogEntry[] = [];
  let seq = 1;

  rows.push({
    seq: seq++,
    agentType: "orchestrator",
    op: "CREATE",
    node: `plans:${apiPlan.planLineageId}`,
    detail: `plan r${apiPlan.revisionNumber} - ${apiPlan.summary ?? ""}`,
    version: `v${apiPlan.revisionNumber}`,
  });

  for (const step of apiPlan.steps) {
    const agent = agentTypeForStep(step.type);
    rows.push({
      seq: seq++,
      agentType: agent,
      op: "COMMIT",
      node: `plan_steps:${step.type}`,
      detail: step.summary,
      version: "v1",
    });
  }

  // Light the graph nodes progressively (one new node per streamed row) so the
  // plane advances to the lit frontier as mutations arrive. Main-path hubs come
  // first and in path order (that is what the plane flies); branch/off-path
  // nodes follow so every "live" node ends up lit. When the graph has more nodes
  // than there are existing rows to carry them, emit extra synthetic READ rows
  // so the tail nodes still light instead of staying permanently dark.
  const { nodes, edges } = buildGraph(apiPlan);
  const mainIds = buildTraversalChain({ nodes, edges }).map((hub) => hub.id);
  const mainSet = new Set(mainIds);
  const order = [...mainIds, ...nodes.map((n) => n.id).filter((id) => !mainSet.has(id))];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  order.forEach((nodeId, i) => {
    if (i < rows.length) {
      rows[i].nodeId = nodeId;
    } else {
      const node = nodeById.get(nodeId);
      rows.push({
        seq: seq++,
        agentType: "system",
        op: "READ",
        node: node ? `${node.kind}:${nodeId}` : `node:${nodeId}`,
        detail: node ? `read ${node.label}` : "read node",
        version: "v1",
        nodeId,
      });
    }
  });

  // Final status beat stays last so the log closes on "plan -> current".
  rows.push({
    seq: seq++,
    agentType: "orchestrator",
    op: "UPDATE",
    node: `plans:${apiPlan.planLineageId}`,
    detail: "status -> current",
    version: `v${apiPlan.revisionNumber}`,
  });

  return rows;
}

/**
 * Computes stale graph elements between rev1 and rev2 for the invalidation event.
 * Rev1 has a transfer_recommendation step; rev2 dropped it after balance transfer.
 */
export function diffStale(rev1: ApiPlan, rev2: ApiPlan): Invalidation {
  const transferStep = rev1.steps.find((s) => s.type === "transfer_recommendation");
  const rev2HasTransfer = rev2.steps.some((s) => s.type === "transfer_recommendation");

  if (!transferStep || rev2HasTransfer || rev1.planLineageId !== rev2.planLineageId) {
    return {
      staleEdgeId: "",
      staleNodeIds: [],
      reason: "",
      mutation: {
        seq: toMutationRows(rev1).length + 1,
        agentType: "system",
        op: "STALE",
        node: `plans:${rev1.planLineageId}`,
        detail: "no transfer diff detected",
        version: "v2",
      },
    };
  }

  const rev2EdgeIds = new Set(rev2.graph?.edges.map((edge) => edge.id) ?? []);
  const transferEdge =
    rev1.graph?.edges.find((edge) => edge.kind === "transfer" && !rev2EdgeIds.has(edge.id)) ?? null;

  if (!transferEdge) {
    return {
      staleEdgeId: "",
      staleNodeIds: [],
      reason: "",
      mutation: {
        seq: toMutationRows(rev1).length + 1,
        agentType: "system",
        op: "STALE",
        node: `plans:${rev1.planLineageId}`,
        detail: "no transfer diff detected",
        version: "v2",
      },
    };
  }

  const staleEdgeId = transferEdge.id;
  const rev2NodeIds = new Set(rev2.graph?.nodes.map((node) => node.id) ?? []);
  const staleNodeIds =
    rev1.graph?.nodes
      .filter((node) => node.kind === "redemption" && !rev2NodeIds.has(node.id))
      .map((node) => node.id) ?? [];

  const rev1Nodes = new Map(rev1.graph?.nodes.map((node) => [node.id, node]) ?? []);
  const sourceLabel = rev1Nodes.get(transferEdge.from)?.label ?? transferEdge.from;
  const destLabel = rev1Nodes.get(transferEdge.to)?.label ?? transferEdge.to;
  const srcLabel = `${sourceLabel} -> ${destLabel}`;
  const seqBase = toMutationRows(rev1).length + 1;

  return {
    staleEdgeId,
    staleNodeIds,
    reason: `${srcLabel} transfer suspended; the booked award is no longer reachable on this path.`,
    mutation: {
      seq: seqBase,
      agentType: "system",
      op: "STALE",
      node: `transfers_to:${transferEdge.id}`,
      detail: "edge deactivated; dependent plan revision -> stale",
      version: "v2",
      nodeId: transferEdge.from,
    },
  };
}

/**
 * Returns scripted balance-transfer params for the seeded demo persona.
 * Throws ApiError if the session is not a seeded persona.
 */
export function transferParamsFromPersona(session: ApiSessionResponse): ApiTransferParams {
  if (!session.seeded) {
    throw new ApiError({
      kind: "server-error",
      status: 422,
      message:
        "transferParamsFromPersona requires a seeded demo persona; real users are not yet supported.",
    });
  }
  return { ...DEMO_TRANSFER };
}
