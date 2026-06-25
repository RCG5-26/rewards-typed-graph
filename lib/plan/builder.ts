/**
 * Deterministic plan builder — the fixture-backed stand-in for the orchestrator.
 *
 * Mirrors `agents/redemption/planner.py`: read the seeded graph, traverse
 * balances → 1:1 transfer → the best reachable redemption option, and emit a
 * typed plan (steps), the `graph_mutations` the agents would commit, and the
 * typed-graph topology the console lights up. Pure and serializable so the same
 * result can later come from `Orchestrator.run()` + the `/mutations` SSE stream.
 *
 * `buildReplan` powers Hero Moment 1: take a transfer edge offline, re-traverse,
 * and return the invalidation plus the new current revision.
 */

import { promises as fs } from "fs";
import path from "path";

import type { UserGraph } from "@/lib/user/types";
import type {
  GoalType,
  GraphEdge,
  GraphNode,
  Invalidation,
  MutationLogEntry,
  PlanResult,
  PlanStep,
  ReplanResult,
} from "./types";

const BP_PER_UNIT = 10000;

interface SeedProgram {
  id: string;
  slug: string;
  name: string;
  currency_name: string;
}
interface SeedTransfer {
  source_program_id: string;
  dest_program_id: string;
  transfer_ratio_basis_points: number;
  is_active: boolean;
}
interface SeedRedemption {
  id: string;
  program_id: string;
  cpp_basis_points: number;
  min_points: number;
  description: string;
}
interface SeedCreditCard {
  id: string;
  reward_program_id: string;
}
interface SeedSeed {
  reward_programs: SeedProgram[];
  transfers_to: SeedTransfer[];
  redemption_options: SeedRedemption[];
  credit_cards: SeedCreditCard[];
}

/**
 * Restrict the user's balances to the reward programs their *selected* cards
 * belong to. This is what makes the card picking matter: pick only United cards
 * and the Chase→Hyatt path isn't reachable, so the plan changes. Empty/no-match
 * selection falls back to the full graph.
 */
function filterGraphBySelection(
  seed: SeedSeed,
  graph: UserGraph,
  selectedCardIds: string[],
): UserGraph {
  if (!selectedCardIds.length) return graph;
  const sel = new Set(selectedCardIds);
  const programIds = new Set(
    seed.credit_cards.filter((c) => sel.has(c.id)).map((c) => c.reward_program_id),
  );
  if (!programIds.size) return graph;
  return { ...graph, balances: graph.balances.filter((b) => programIds.has(b.programId)) };
}

const GOAL_LABEL: Record<GoalType, string> = {
  maximize_points: "maximize points",
  maximize_cashback: "maximize cashback",
  specific_redemption: "specific redemption",
  minimize_fees: "minimize fees",
};

/** Mirror of the design's `deriveGoal`, mapped onto orchestrator goal types. */
export function deriveGoalType(query: string): GoalType {
  const s = (query || "").toLowerCase();
  if (/fee|annual/.test(s)) return "minimize_fees";
  if (/cash\s?back|cashback|everyday|grocer/.test(s)) return "maximize_cashback";
  if (/bonus|welcome|signup|sign-up/.test(s)) return "maximize_points";
  return "specific_redemption";
}

function stableId(prefix: string, seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return `${prefix}_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

const progNodeId = (slug: string) => `prog:${slug}`;
const redeemNodeId = (optionId: string) => `redeem:${optionId}`;

interface Candidate {
  option: SeedRedemption;
  destProgram: SeedProgram;
  heldAtDest: number;
  requiredTransfer: number;
  sourceProgram: SeedProgram | null;
  valueCents: number;
}

/**
 * Best reachable redemption: held balance + a single 1:1 transfer hop.
 * `excludedEdges` is a set of `${srcId}->${destId}` transfer edges to skip
 * (used by replan to take a path offline).
 */
function bestCandidate(
  seed: SeedSeed,
  balanceByProgram: Map<string, number>,
  excludedEdges: Set<string>,
): Candidate | null {
  const programsById = new Map(seed.reward_programs.map((p) => [p.id, p]));
  const candidates: Candidate[] = [];

  for (const option of seed.redemption_options) {
    const destProgram = programsById.get(option.program_id);
    if (!destProgram) continue;
    const heldAtDest = balanceByProgram.get(option.program_id) ?? 0;
    const shortfall = Math.max(0, option.min_points - heldAtDest);

    let requiredTransfer = 0;
    let sourceProgram: SeedProgram | null = null;
    if (shortfall > 0) {
      const edge = seed.transfers_to.find((t) => {
        if (!t.is_active || t.dest_program_id !== option.program_id) return false;
        if (excludedEdges.has(`${t.source_program_id}->${t.dest_program_id}`)) return false;
        const ratio = t.transfer_ratio_basis_points / BP_PER_UNIT;
        const need = Math.ceil(shortfall / ratio);
        return (balanceByProgram.get(t.source_program_id) ?? 0) >= need;
      });
      if (!edge) continue;
      const ratio = edge.transfer_ratio_basis_points / BP_PER_UNIT;
      requiredTransfer = Math.ceil(shortfall / ratio);
      sourceProgram = programsById.get(edge.source_program_id) ?? null;
    }

    const valueCents = Math.round((option.min_points * option.cpp_basis_points) / BP_PER_UNIT);
    candidates.push({ option, destProgram, heldAtDest, requiredTransfer, sourceProgram, valueCents });
  }

  candidates.sort(
    (a, b) => b.valueCents - a.valueCents || a.requiredTransfer - b.requiredTransfer,
  );
  return candidates[0] ?? null;
}

interface ComputeOpts {
  revision: number;
  excludedEdges: Set<string>;
  /** Continue the mutation sequence numbering from here (for replan). */
  seqStart: number;
}

/** Core traversal → a full PlanResult for one revision. */
function computePlan(
  seed: SeedSeed,
  graph: UserGraph,
  queryText: string,
  opts: ComputeOpts,
): PlanResult {
  const programsById = new Map(seed.reward_programs.map((p) => [p.id, p]));
  const goalType = deriveGoalType(queryText);
  const balanceByProgram = new Map(graph.balances.map((b) => [b.programId, b.balancePoints]));
  const pointsOnHand = graph.balances.reduce((s, b) => s + b.balancePoints, 0);

  const planLineageId = stableId("lin", queryText);
  const planId = stableId("plan", `${queryText}#${opts.revision}`);

  const winner = bestCandidate(seed, balanceByProgram, opts.excludedEdges);

  const steps: PlanStep[] = [];
  const mutations: MutationLogEntry[] = [];
  let seq = opts.seqStart;
  const mut = (e: Omit<MutationLogEntry, "seq">) => mutations.push({ seq: seq++, ...e });

  // orchestrator: decompose
  steps.push({
    order: 1,
    agentType: "orchestrator",
    type: "decompose_query",
    title: "Decompose the goal into typed agent invocations",
    reasoning:
      "The orchestrator turns the natural-language goal into wallet, earning, and redemption operations — coordination is typed graph state, never free text.",
    status: "current",
    deps: [],
  });
  mut({ agentType: "orchestrator", op: "CREATE", node: `plans:${planLineageId}`, detail: `plan r${opts.revision} · goal ${goalType}`, version: `v${opts.revision}` });

  // wallet_agent: assess balances
  steps.push({
    order: 2,
    agentType: "wallet_agent",
    type: "assess_wallet",
    title: `Read balances across ${graph.balances.length} program${graph.balances.length === 1 ? "" : "s"}`,
    reasoning: `${pointsOnHand.toLocaleString("en-US")} pts on hand — ${graph.balances
      .map((b) => `${b.balancePoints.toLocaleString("en-US")} ${b.programName}`)
      .join(", ")}.`,
    status: "current",
    deps: [],
  });
  for (const b of graph.balances) {
    const slug = programsById.get(b.programId)?.slug ?? b.programId;
    mut({ agentType: "wallet_agent", op: "READ", node: `user_balances:${b.programName}`, detail: `${b.balancePoints.toLocaleString("en-US")} ${b.currencyName}`, version: "v1", nodeId: progNodeId(slug) });
  }

  // ── build the typed-graph topology from held programs ──
  const nodes: GraphNode[] = graph.balances.map((b) => {
    const slug = programsById.get(b.programId)?.slug ?? b.programId;
    return { id: progNodeId(slug), label: b.programName, kind: "program", col: 0, state: "active" };
  });
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges: GraphEdge[] = [];

  if (!winner) {
    mut({ agentType: "orchestrator", op: "UPDATE", node: `plans:${planLineageId}`, detail: "no reachable redemption · failed", version: `v${opts.revision}` });
    return {
      planId, planLineageId, status: "failed", agentRunIds: [stableId("run", `${queryText}#${opts.revision}`)],
      revision: opts.revision, goalType, goalLabel: GOAL_LABEL[goalType], queryText,
      route: "no affordable redemption from current balances",
      planValueCents: 0, liveNodes: nodes.length, steps, mutations,
      graph: { nodes, edges },
    };
  }

  const { option, destProgram, heldAtDest, requiredTransfer, sourceProgram, valueCents } = winner;
  const cpp = (option.cpp_basis_points / BP_PER_UNIT).toFixed(2);
  const destNodeId = progNodeId(destProgram.slug);
  const awardNodeId = redeemNodeId(option.id);

  // place dest at col 1, add redemption at col 2
  const destNode = nodeById.get(destNodeId);
  if (destNode) destNode.col = 1;
  else nodes.push({ id: destNodeId, label: destProgram.name, kind: "program", col: 1, state: "active" });
  nodes.push({ id: awardNodeId, label: option.description, kind: "redemption", col: 2, state: "active" });

  // redemption_agent: transfer hop
  if (requiredTransfer > 0 && sourceProgram) {
    const srcSlug = sourceProgram.slug;
    const srcBefore = balanceByProgram.get(sourceProgram.id) ?? 0;
    edges.push({ id: `edge:transfer:${srcSlug}->${destProgram.slug}`, from: progNodeId(srcSlug), to: destNodeId, kind: "transfer", state: "active" });
    steps.push({
      order: steps.length + 1,
      agentType: "redemption_agent",
      type: "traverse_redemption",
      title: `Transfer ${requiredTransfer.toLocaleString("en-US")} ${sourceProgram.name} → ${destProgram.name} (1:1)`,
      reasoning: `The award needs ${option.min_points.toLocaleString("en-US")} ${destProgram.name} pts; you hold ${heldAtDest.toLocaleString("en-US")}, so transfer ${requiredTransfer.toLocaleString("en-US")} from ${sourceProgram.name} at the seeded 1:1 ratio.`,
      status: "current",
      deps: [`user_balances:${sourceProgram.name}`],
    });
    mut({ agentType: "redemption_agent", op: "READ", node: `transfers_to:${srcSlug}→${destProgram.slug}`, detail: "active 1:1 transfer edge", version: "v1", nodeId: progNodeId(srcSlug) });
    mut({ agentType: "redemption_agent", op: "COMMIT", node: `user_balances:${sourceProgram.name}`, detail: `${srcBefore.toLocaleString("en-US")} → ${(srcBefore - requiredTransfer).toLocaleString("en-US")}`, version: "v2", nodeId: progNodeId(srcSlug) });
    mut({ agentType: "redemption_agent", op: "UPDATE", node: `user_balances:${destProgram.name}`, detail: `${heldAtDest.toLocaleString("en-US")} → ${(heldAtDest + requiredTransfer).toLocaleString("en-US")}`, version: "v2", nodeId: destNodeId });
  }

  // redemption_agent: book the award
  edges.push({ id: `edge:redeem:${destProgram.slug}->${option.id}`, from: destNodeId, to: awardNodeId, kind: "redeem", state: "active" });
  steps.push({
    order: steps.length + 1,
    agentType: "redemption_agent",
    type: "traverse_redemption",
    title: `Book ${option.description} for ${option.min_points.toLocaleString("en-US")} ${destProgram.name} pts`,
    reasoning: `${cpp}¢/pt against the seeded cash price — the highest-value affordable option reachable from your balances (~$${Math.round(valueCents / 100).toLocaleString("en-US")}).`,
    status: "current",
    deps: requiredTransfer > 0 ? [`user_balances:${destProgram.name}`] : [],
  });
  mut({ agentType: "redemption_agent", op: "READ", node: `redemption_options:${destProgram.slug}`, detail: `min ${option.min_points.toLocaleString("en-US")} @ ${cpp}¢`, version: "v1", nodeId: awardNodeId });
  mut({ agentType: "redemption_agent", op: "COMMIT", node: `plan_steps:book_award`, detail: `${option.description} · $${Math.round(valueCents / 100).toLocaleString("en-US")}`, version: "v1", nodeId: awardNodeId });
  mut({ agentType: "orchestrator", op: "UPDATE", node: `plans:${planLineageId}`, detail: "status → current", version: `v${opts.revision}` });

  const route = sourceProgram
    ? `${sourceProgram.name} → ${destProgram.name} → ${option.description}`
    : `${destProgram.name} → ${option.description}`;

  return {
    planId, planLineageId, status: "current", agentRunIds: [stableId("run", `${queryText}#${opts.revision}`)],
    revision: opts.revision, goalType, goalLabel: GOAL_LABEL[goalType], queryText,
    route, planValueCents: valueCents, liveNodes: nodes.length, steps, mutations,
    graph: { nodes, edges },
  };
}

async function loadSeed(): Promise<SeedSeed> {
  const file = path.join(process.cwd(), "fixtures", "demo-seed.json");
  return JSON.parse(await fs.readFile(file, "utf-8")) as SeedSeed;
}

export async function buildPlan(
  graph: UserGraph,
  selectedCardIds: string[],
  queryText: string,
): Promise<PlanResult> {
  const seed = await loadSeed();
  const eff = filterGraphBySelection(seed, graph, selectedCardIds);
  return computePlan(seed, eff, queryText, { revision: 1, excludedEdges: new Set(), seqStart: 1 });
}

/**
 * Hero Moment 1 — invalidate the revision-1 transfer path and re-traverse.
 *
 * Simulates the winning transfer edge going offline (e.g. the Chase→Hyatt
 * route is suspended): the dependent plan revision goes stale, the redemption
 * agent re-plans onto the next reachable option, and a new current revision
 * supersedes the prior one. Returns the invalidation + revision 2.
 */
export async function buildReplan(
  graph: UserGraph,
  selectedCardIds: string[],
  queryText: string,
): Promise<ReplanResult | null> {
  const seed = await loadSeed();
  const eff = filterGraphBySelection(seed, graph, selectedCardIds);
  const rev1 = computePlan(seed, eff, queryText, { revision: 1, excludedEdges: new Set(), seqStart: 1 });
  if (rev1.status === "failed") return null;

  // The transfer edge that revision 1 relied on (if any).
  const usedTransfer = rev1.graph.edges.find((e) => e.kind === "transfer");
  const staleAward = rev1.graph.nodes.find((n) => n.kind === "redemption");
  if (!usedTransfer) return null; // direct redemption — nothing to take offline

  // Map the edge back to program ids to exclude it from the re-traversal.
  const slugToId = new Map(seed.reward_programs.map((p) => [p.slug, p.id]));
  const srcSlug = usedTransfer.from.replace("prog:", "");
  const destSlug = usedTransfer.to.replace("prog:", "");
  const excluded = new Set<string>();
  const srcId = slugToId.get(srcSlug);
  const destId = slugToId.get(destSlug);
  if (srcId && destId) excluded.add(`${srcId}->${destId}`);

  const seqStart = rev1.mutations.length + 2; // leave room for the STALE row
  const invalidation: Invalidation = {
    staleEdgeId: usedTransfer.id,
    staleNodeIds: staleAward ? [staleAward.id] : [],
    reason: `${srcSlug} → ${destSlug} transfer suspended — the booked award is no longer reachable on this path.`,
    mutation: {
      seq: rev1.mutations.length + 1,
      agentType: "system",
      op: "STALE",
      node: `transfers_to:${srcSlug}→${destSlug}`,
      detail: "edge deactivated · dependent plan revision → stale",
      version: "v2",
      nodeId: usedTransfer.from,
    },
  };

  const rev2 = computePlan(seed, eff, queryText, { revision: 2, excludedEdges: excluded, seqStart });

  // Tag the leading mutation of the replan so the log reads as a re-plan.
  if (rev2.mutations[0]) {
    rev2.mutations[0] = { ...rev2.mutations[0], op: "REPLAN", detail: "re-planning on invalidation · new revision" };
  }
  return { invalidation, plan: rev2 };
}
