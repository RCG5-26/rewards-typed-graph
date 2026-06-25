/**
 * Pure adapter functions mapping Hono API response shapes to frontend view models.
 * No I/O — fully unit-testable against captured API fixtures.
 * Web tier is database-less (KTD-5); demo-seed mappings are static.
 */

import { deriveGoalType } from "@/lib/plan/builder";
import type {
  AgentType,
  GraphEdge,
  GraphNode,
  Invalidation,
  MutationLogEntry,
  PlanResult,
  PlanStep,
} from "@/lib/plan/types";
import type { ApiPlan, ApiSessionResponse, ApiTransferParams } from "./types";
import { ApiError } from "./types";

// ── Demo-seed static mappings (web is database-less, KTD-5) ─────────────────

/** Maps user_balance.id → the program it tracks. */
const BALANCE_TO_PROGRAM: Record<
  string,
  { name: string; slug: string; programId: string }
> = {
  "00000000-0000-0000-0000-00000000d001": {
    name: "Chase Ultimate Rewards",
    slug: "chase_ur",
    programId: "00000000-0000-0000-0000-00000000b001",
  },
  "00000000-0000-0000-0000-00000000d002": {
    name: "World of Hyatt",
    slug: "hyatt",
    programId: "00000000-0000-0000-0000-00000000b002",
  },
  "00000000-0000-0000-0000-00000000d003": {
    name: "United MileagePlus",
    slug: "united",
    programId: "00000000-0000-0000-0000-00000000b003",
  },
};

/** Maps redemption_option.id → display info. */
const REDEMPTION_NODES: Record<string, { description: string; programSlug: string }> = {
  "00000000-0000-0000-0000-00000000f001": {
    description: "Demo Hyatt Ginza 3-night Tokyo award",
    programSlug: "hyatt",
  },
  "00000000-0000-0000-0000-00000000f002": {
    description: "United MileagePlus Tokyo saver award",
    programSlug: "united",
  },
};

/** Maps transfers_to.id → source/dest slugs. */
const TRANSFER_EDGE_SLUGS: Record<string, { srcSlug: string; destSlug: string }> = {
  "00000000-0000-0000-0000-00000000e001": {
    srcSlug: "chase_ur",
    destSlug: "hyatt",
  },
  "00000000-0000-0000-0000-00000000e002": {
    srcSlug: "chase_ur",
    destSlug: "united",
  },
};

/** The scripted demo transfer params for the seeded persona. */
const DEMO_TRANSFER: ApiTransferParams = {
  sourceProgramId: "00000000-0000-0000-0000-00000000b001",
  destProgramId: "00000000-0000-0000-0000-00000000b002",
  amountPoints: 30000,
};

// ── Agent type inference ─────────────────────────────────────────────────────

const STEP_TYPE_TO_AGENT: Record<string, AgentType> = {
  spend_analysis: "wallet_agent",
  transfer_recommendation: "redemption_agent",
  redemption_recommendation: "redemption_agent",
  decompose_query: "orchestrator",
};

function agentTypeForStep(type: string): AgentType {
  return STEP_TYPE_TO_AGENT[type] ?? "orchestrator";
}

// ── Graph builder ────────────────────────────────────────────────────────────

function buildGraph(apiPlan: ApiPlan): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const allDeps = apiPlan.steps.flatMap((s) => s.dependsOn);
  const depSet = new Set(allDeps);

  const programNodes = new Map<string, GraphNode>();
  const redeemNodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  // Program nodes from balance UUIDs
  for (const depId of depSet) {
    const prog = BALANCE_TO_PROGRAM[depId];
    if (prog && !programNodes.has(prog.slug)) {
      programNodes.set(prog.slug, {
        id: `prog:${prog.slug}`,
        label: prog.name,
        kind: "program",
        col: 0,
        state: "active",
      });
    }
  }

  // Transfer edges and dest-column repositioning
  for (const depId of depSet) {
    const te = TRANSFER_EDGE_SLUGS[depId];
    if (te) {
      const src = programNodes.get(te.srcSlug);
      const dest = programNodes.get(te.destSlug);
      if (src && dest) {
        dest.col = 1;
        edges.push({
          id: `edge:transfer:${te.srcSlug}->${te.destSlug}`,
          from: `prog:${te.srcSlug}`,
          to: `prog:${te.destSlug}`,
          kind: "transfer",
          state: "active",
        });
      }
    }
  }

  // Redemption nodes and their edges
  for (const depId of depSet) {
    const rn = REDEMPTION_NODES[depId];
    if (rn && !redeemNodes.has(depId)) {
      const nodeId = `redeem:${depId}`;
      redeemNodes.set(depId, {
        id: nodeId,
        label: rn.description,
        kind: "redemption",
        col: 2,
        state: "active",
      });
      const progNode = programNodes.get(rn.programSlug);
      if (progNode) {
        edges.push({
          id: `edge:redeem:${rn.programSlug}->${depId}`,
          from: `prog:${rn.programSlug}`,
          to: nodeId,
          kind: "redeem",
          state: "active",
        });
      }
    }
  }

  const nodes = [...programNodes.values(), ...redeemNodes.values()];
  return { nodes, edges };
}

// ── Route string derivation ──────────────────────────────────────────────────

function deriveRoute(apiPlan: ApiPlan): string {
  const transferStep = apiPlan.steps.find((s) => s.type === "transfer_recommendation");
  if (transferStep) {
    // e.g. "Transfer 30,000 Chase UR → World of Hyatt (1:1)"
    return transferStep.summary;
  }
  const redeemStep = apiPlan.steps.find((s) => s.type === "redemption_recommendation");
  return redeemStep?.summary ?? apiPlan.summary;
}

// ── Public adapter functions ─────────────────────────────────────────────────

/** Maps a live Hono API plan body → the frontend PlanResult view model. */
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
    detail: `plan r${apiPlan.revisionNumber} · ${apiPlan.summary}`,
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

  rows.push({
    seq: seq++,
    agentType: "orchestrator",
    op: "UPDATE",
    node: `plans:${apiPlan.planLineageId}`,
    detail: "status → current",
    version: `v${apiPlan.revisionNumber}`,
  });

  return rows;
}

/**
 * Computes the stale graph elements between rev1 and rev2 for the invalidation event.
 * Rev1 has a transfer_recommendation step; rev2 dropped it (balance transfer happened).
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

  // Find the transfer edge UUID in the dropped step's dependsOn
  const transferEdgeId = transferStep.dependsOn.find((id) => id in TRANSFER_EDGE_SLUGS);
  const te = transferEdgeId ? TRANSFER_EDGE_SLUGS[transferEdgeId] : null;
  const staleEdgeId = te ? `edge:transfer:${te.srcSlug}->${te.destSlug}` : "";

  // Nodes reachable only via the stale transfer (redemption nodes in rev1 not in rev2)
  const rev1Deps = new Set(rev1.steps.flatMap((s) => s.dependsOn));
  const rev2Deps = new Set(rev2.steps.flatMap((s) => s.dependsOn));
  const staleRedemptionIds = [...rev1Deps].filter(
    (id) => id in REDEMPTION_NODES && !rev2Deps.has(id),
  );
  const staleNodeIds = staleRedemptionIds.map((id) => `redeem:${id}`);

  const srcLabel = te ? `${te.srcSlug} → ${te.destSlug}` : "transfer edge";
  const seqBase = toMutationRows(rev1).length + 1;

  return {
    staleEdgeId,
    staleNodeIds,
    reason: `${srcLabel} transfer suspended — the booked award is no longer reachable on this path.`,
    mutation: {
      seq: seqBase,
      agentType: "system",
      op: "STALE",
      node: `transfers_to:${srcLabel}`,
      detail: "edge deactivated · dependent plan revision → stale",
      version: "v2",
      nodeId: te ? `prog:${te.srcSlug}` : undefined,
    },
  };
}

/**
 * Returns scripted balance-transfer params for the seeded demo persona.
 * Throws ApiError if the session is not a seeded persona (web is database-less, KTD-5).
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
