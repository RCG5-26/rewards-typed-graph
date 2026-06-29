/**
 * Normalize a Python LLM-baseline plan into the shared {@link NormalizedPlan}.
 *
 * Both baselines emit the same final-plan shape:
 *   { status, chosen_award_slug, fallback, ranked_awards, steps }
 * The free-text crew wraps it as `{ agent_transcript, final_plan }`; the single
 * agent returns it directly. {@link extractFinalPlan} unwraps either form.
 *
 * The baselines' only RELIABLE structured signal is `chosen_award_slug` — the
 * award they decided to pursue. Their `steps` are free-text prose, which is
 * ambiguous to parse into typed actions (a hedge like "use United as a backup"
 * or a mention-order quirk like "your Hyatt balance and transfer from Chase"
 * used to be mis-typed as unsupported/backwards transfers, failing otherwise-
 * correct plans). So we do NOT parse prose for transfers. Instead we judge the
 * baseline on its award choice and derive the REQUIRED transfer deterministically
 * from the canonical facts — the identical, architecture-neutral deficit math the
 * graph orchestrator and the evaluator already use. The prose is never trusted to
 * type a transfer; a baseline that picks an unaffordable/unreachable award still
 * fails honestly on the affordability gate.
 */

import {
  type CanonicalAwardOption,
  type CanonicalWalletFacts,
} from "../canonical-wallet";
import type { NormalizedActionType, NormalizedPlan, NormalizedPlanStep } from "../types";

export interface BaselineFinalPlan {
  status?: unknown;
  chosen_award_slug?: unknown;
  fallback?: unknown;
  ranked_awards?: unknown;
  steps?: unknown;
}

/** Unwrap the free-text crew envelope ({final_plan}) or return the plan as-is. */
export function extractFinalPlan(rawOutput: unknown): BaselineFinalPlan {
  if (rawOutput && typeof rawOutput === "object") {
    const record = rawOutput as Record<string, unknown>;
    if (record.final_plan && typeof record.final_plan === "object") {
      return record.final_plan as BaselineFinalPlan;
    }
    return record as BaselineFinalPlan;
  }
  return {};
}

export function normalizeBaselinePlan(
  rawOutput: unknown,
  facts: CanonicalWalletFacts,
): NormalizedPlan {
  const finalPlan = extractFinalPlan(rawOutput);
  const chosenAwardSlug =
    typeof finalPlan.chosen_award_slug === "string" ? finalPlan.chosen_award_slug : undefined;
  const selectedAward = facts.awardOptions.find((a) => a.awardSlug === chosenAwardSlug);
  const status = typeof finalPlan.status === "string" ? finalPlan.status : undefined;
  const fallback = typeof finalPlan.fallback === "string" ? finalPlan.fallback : null;

  // Deterministic plan derived from the structured award choice — no prose parsing.
  const transfer = selectedAward ? requiredTransfer(selectedAward, facts) : null;
  const steps: NormalizedPlanStep[] = [];
  if (transfer) {
    steps.push({
      order: steps.length + 1,
      actionType: "transfer",
      title: `Transfer ${fmt(transfer.points)} ${programName(facts, transfer.sourceProgramId)} points to ${programName(facts, transfer.destinationProgramId)}`,
      sourceProgramId: transfer.sourceProgramId,
      destinationProgramId: transfer.destinationProgramId,
      points: transfer.points,
    });
  }
  if (selectedAward) {
    steps.push({
      order: steps.length + 1,
      actionType: "redeem",
      title: `Redeem ${selectedAward.displayName} for ${fmt(selectedAward.pointsRequired)} ${programName(facts, selectedAward.programId)} points`,
      awardId: selectedAward.awardSlug,
      points: selectedAward.pointsRequired,
    });
  }

  return {
    summary: buildSummary(chosenAwardSlug, selectedAward?.displayName, fallback, steps),
    goalSatisfied: status === "current" && chosenAwardSlug !== undefined,
    transferRequired: transfer !== null,
    ...(transfer ? { transferAmount: transfer.points } : {}),
    ...(selectedAward ? { selectedProgramId: selectedAward.programId } : {}),
    ...(chosenAwardSlug ? { selectedAwardId: chosenAwardSlug } : {}),
    ...(selectedAward ? { redemptionPoints: selectedAward.pointsRequired } : {}),
    steps,
  };
}

interface DerivedTransfer {
  sourceProgramId: string;
  destinationProgramId: string;
  points: number;
}

/**
 * The transfer required to fund the chosen award, computed from the canonical
 * facts (not parsed from prose). Returns null when the destination program
 * already covers the award, or when no supported route has enough source
 * balance to close the deficit (the plan then fails honestly on affordability).
 * Architecture-neutral: the same math runs for every baseline.
 */
export function requiredTransfer(
  award: CanonicalAwardOption,
  facts: CanonicalWalletFacts,
): DerivedTransfer | null {
  const destBalance = facts.balances.find((b) => b.programId === award.programId)?.points ?? 0;
  const deficit = Math.max(0, award.pointsRequired - destBalance);
  if (deficit === 0) return null;

  for (const route of facts.transferRoutes) {
    if (route.destinationProgramId !== award.programId) continue;
    const ratio = route.ratioBasisPoints / 10000;
    if (ratio <= 0) continue;
    const sourceNeeded = Math.ceil(deficit / ratio);
    const sourceBalance =
      facts.balances.find((b) => b.programId === route.sourceProgramId)?.points ?? 0;
    if (sourceBalance >= sourceNeeded) {
      return {
        sourceProgramId: route.sourceProgramId,
        destinationProgramId: award.programId,
        points: sourceNeeded,
      };
    }
  }
  return null;
}

function programName(facts: CanonicalWalletFacts, programId: string): string {
  return facts.programs.find((p) => p.programId === programId)?.name ?? programId;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function buildSummary(
  chosenAwardSlug: string | undefined,
  awardName: string | undefined,
  fallback: string | null,
  steps: NormalizedPlanStep[],
): string {
  if (chosenAwardSlug) {
    return awardName ? `Recommends ${awardName}.` : `Recommends ${chosenAwardSlug}.`;
  }
  if (fallback) return `Recommends a ${fallback} fallback.`;
  if (steps.length > 0) return steps[0].title;
  return "No recommendation produced.";
}

// ---------------------------------------------------------------------------
// Shared prose helpers — used by the GRAPH normalizer (graph-normalizer.ts) to
// type and fill amounts on the orchestrator's controlled, typed step summaries.
// The baseline path above no longer parses prose, but the graph path still
// relies on these for steps whose typed kind needs a fallback / an implied
// transfer amount. Kept here to avoid churning graph-normalizer's import.
// ---------------------------------------------------------------------------

const ACTION_KEYWORDS: ReadonlyArray<readonly [NormalizedActionType, readonly string[]]> = [
  ["transfer", ["transfer"]],
  ["redeem", ["redeem", "book", "award"]],
  ["fallback", ["cash", "fallback"]],
  ["hold", ["hold", "keep", "wait"]],
];

/** Classify a step by its EARLIEST action verb (not an incidental substring). */
export function classifyAction(text: string): NormalizedActionType {
  const t = text.toLowerCase();
  let best: { type: NormalizedActionType; index: number } | null = null;
  for (const [type, keywords] of ACTION_KEYWORDS) {
    for (const keyword of keywords) {
      const at = t.indexOf(keyword);
      if (at !== -1 && (best === null || at < best.index)) best = { type, index: at };
    }
  }
  return best?.type ?? "other";
}

/** First integer with optional comma grouping (e.g. "15,000" → 15000). */
export function parsePoints(text: string): number | undefined {
  const match = text.match(/(\d{1,3}(?:,\d{3})+|\d{4,})/);
  if (!match) return undefined;
  const value = Number.parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Fill the deterministic deficit amount on a transfer step that names the
 * award's destination program but omits the number (the graph view carries
 * transfers as edges without amounts). Architecture-neutral; never adds a
 * transfer the plan never expressed.
 */
export function fillImpliedTransferAmounts(
  plan: NormalizedPlan,
  facts: CanonicalWalletFacts,
): NormalizedPlan {
  const award = facts.awardOptions.find(
    (a) => a.awardSlug === plan.selectedAwardId || a.awardId === plan.selectedAwardId,
  );
  if (!award) return plan;
  const startingDestBalance =
    facts.balances.find((b) => b.programId === award.programId)?.points ?? 0;
  const deficit = Math.max(0, award.pointsRequired - startingDestBalance);
  if (deficit === 0) return plan;

  let changed = false;
  const steps = plan.steps.map((step) => {
    if (
      step.actionType === "transfer" &&
      step.points === undefined &&
      resolvesToProgram(step.destinationProgramId, award.programId, facts)
    ) {
      changed = true;
      return { ...step, points: deficit };
    }
    return step;
  });
  if (!changed) return plan;

  const transferStep = steps.find((s) => s.actionType === "transfer");
  return {
    ...plan,
    steps,
    ...(transferStep?.points !== undefined ? { transferAmount: transferStep.points } : {}),
  };
}

function resolvesToProgram(
  value: string | undefined,
  programId: string,
  facts: CanonicalWalletFacts,
): boolean {
  if (!value) return false;
  if (value === programId) return true;
  const program = facts.programs.find((p) => p.programId === programId);
  return program?.programSlug === value;
}
