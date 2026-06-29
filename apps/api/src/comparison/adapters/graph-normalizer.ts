/**
 * Normalize a live graph-orchestrator {@link PlanView} into the shared
 * {@link NormalizedPlan}. The graph encodes its plan two ways: ordered
 * `steps` (titles + reasoning) and a typed `graph` of program/redemption nodes
 * joined by transfer/redeem edges. The edges carry the structured routing the
 * step prose may not, so this reads both: steps for ordering/labels, edges for
 * the selected award, the redeeming program, and the transfer route.
 *
 * Transfer amounts are not present in the view; {@link fillImpliedTransferAmounts}
 * supplies the deterministic deficit afterward, the same way it does for the
 * baselines.
 */

import type { CanonicalWalletFacts } from "../canonical-wallet";
import type { NormalizedActionType, NormalizedPlan, NormalizedPlanStep } from "../types";
import type {
  PlanGraphEdgeView,
  PlanGraphNodeView,
  PlanStepView,
  PlanView,
} from "../../plans/types";
import { classifyAction, fillImpliedTransferAmounts, parsePoints } from "./baseline-normalizer";

export function normalizeGraphPlan(view: PlanView, facts: CanonicalWalletFacts): NormalizedPlan {
  const nodeById = new Map<string, PlanGraphNodeView>(view.graph.nodes.map((n) => [n.id, n]));
  const transferEdge = view.graph.edges.find((e) => e.kind === "transfer");
  const redeemEdge = view.graph.edges.find((e) => e.kind === "redeem");

  const selectedAwardId = resolveSelectedAward(view, facts);
  const selectedAward = facts.awardOptions.find(
    (a) => a.awardSlug === selectedAwardId || a.awardId === selectedAwardId,
  );
  const selectedProgramId = resolveSelectedProgram(redeemEdge, nodeById, selectedAward?.programId);

  const steps = buildSteps(view.steps, transferEdge, nodeById);
  const transferStep = steps.find((s) => s.actionType === "transfer");

  const plan: NormalizedPlan = {
    summary: view.summary ?? buildSummary(selectedAward?.displayName, selectedAwardId),
    goalSatisfied: view.status === "current",
    transferRequired: transferStep !== undefined,
    ...(transferStep?.points !== undefined ? { transferAmount: transferStep.points } : {}),
    ...(selectedProgramId ? { selectedProgramId } : {}),
    ...(selectedAwardId ? { selectedAwardId } : {}),
    ...(selectedAward ? { redemptionPoints: selectedAward.pointsRequired } : {}),
    steps,
  };
  return fillImpliedTransferAmounts(plan, facts);
}

function buildSteps(
  stepViews: PlanStepView[],
  transferEdge: PlanGraphEdgeView | undefined,
  nodeById: Map<string, PlanGraphNodeView>,
): NormalizedPlanStep[] {
  const steps: NormalizedPlanStep[] = stepViews.map((step) => normalizeStep(step, transferEdge, nodeById));

  // The transfer may live only as a graph edge (a balance mutation, not a step).
  // Represent it as a transfer step so the evaluator can credit it; the amount is
  // filled in later from facts.
  const hasTransferStep = steps.some((s) => s.actionType === "transfer");
  if (transferEdge && !hasTransferStep) {
    const source = nodeById.get(transferEdge.from);
    const destination = nodeById.get(transferEdge.to);
    steps.push({
      order: steps.length + 1,
      actionType: "transfer",
      title: `Transfer ${source?.label ?? "points"} → ${destination?.label ?? "destination"}`,
      ...(source?.programId ? { sourceProgramId: source.programId } : {}),
      ...(destination?.programId ? { destinationProgramId: destination.programId } : {}),
    });
  }
  return steps;
}

function normalizeStep(
  step: PlanStepView,
  transferEdge: PlanGraphEdgeView | undefined,
  nodeById: Map<string, PlanGraphNodeView>,
): NormalizedPlanStep {
  const actionType = classifyGraphStep(step.type, step.summary);
  const normalized: NormalizedPlanStep = {
    order: step.order,
    actionType,
    title: step.summary,
    ...(step.reasoning ? { reasoningSummary: step.reasoning } : {}),
  };
  if (actionType === "transfer") {
    const points = parsePoints(step.summary);
    if (points !== undefined) normalized.points = points;
    const source = transferEdge ? nodeById.get(transferEdge.from) : undefined;
    const destination = transferEdge ? nodeById.get(transferEdge.to) : undefined;
    if (source?.programId) normalized.sourceProgramId = source.programId;
    if (destination?.programId) normalized.destinationProgramId = destination.programId;
  }
  return normalized;
}

function classifyGraphStep(type: string, summary: string): NormalizedActionType {
  const t = type.toLowerCase();
  if (t.includes("transfer")) return "transfer";
  if (t.includes("redemption") || t.includes("redeem")) return "redeem";
  return classifyAction(summary);
}

/** The redemption node's slug is the selected award (canonicalized to awardSlug). */
function resolveSelectedAward(view: PlanView, facts: CanonicalWalletFacts): string | undefined {
  const redemptionNode = view.graph.nodes.find((n) => n.kind === "redemption");
  if (redemptionNode) {
    const slug = canonicalAwardSlug(redemptionNode.slug, facts);
    if (slug) return slug;
  }
  // Fall back to a step dependency that names a known award.
  for (const step of view.steps) {
    for (const dependency of step.dependencies) {
      const slug = canonicalAwardSlug(dependency.slug, facts);
      if (slug) return slug;
    }
  }
  return redemptionNode?.slug;
}

function resolveSelectedProgram(
  redeemEdge: PlanGraphEdgeView | undefined,
  nodeById: Map<string, PlanGraphNodeView>,
  fallbackProgramId: string | undefined,
): string | undefined {
  if (redeemEdge) {
    const from = nodeById.get(redeemEdge.from);
    if (from?.programId) return from.programId;
  }
  return fallbackProgramId;
}

function isKnownAward(slug: string, facts: CanonicalWalletFacts): boolean {
  return canonicalAwardSlug(slug, facts) !== undefined;
}

/** Map a graph node slug (UUID or award: slug) to the canonical awardSlug. */
function canonicalAwardSlug(
  identifier: string,
  facts: CanonicalWalletFacts,
): string | undefined {
  return facts.awardOptions.find(
    (a) => a.awardSlug === identifier || a.awardId === identifier,
  )?.awardSlug;
}

function buildSummary(awardName: string | undefined, awardId: string | undefined): string {
  if (awardName) return `Recommends ${awardName}.`;
  if (awardId) return `Recommends ${awardId}.`;
  return "Graph plan produced no redemption.";
}
