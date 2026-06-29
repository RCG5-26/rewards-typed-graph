/**
 * Normalize a Python LLM-baseline plan into the shared {@link NormalizedPlan}.
 *
 * Both baselines emit the same final-plan shape:
 *   { status, chosen_award_slug, fallback, unsupported_reason, ranked_awards, steps }
 * The free-text crew wraps it as `{ agent_transcript, final_plan }`; the single
 * agent returns it directly. {@link extractFinalPlan} unwraps either form.
 *
 * Steps are free-text prose, so this parses them heuristically: it detects the
 * action type by keyword and pulls a points amount and program references from
 * the text. It never invents a transfer the model did not describe — if the
 * model only wrote "redeem Ginza", the normalized plan has no transfer step and
 * the evaluator will judge it unaffordable on its own.
 */

import type { CanonicalWalletFacts } from "../canonical-wallet";
import type { NormalizedActionType, NormalizedPlan, NormalizedPlanStep } from "../types";

export interface BaselineFinalPlan {
  status?: unknown;
  chosen_award_slug?: unknown;
  fallback?: unknown;
  ranked_awards?: unknown;
  steps?: unknown;
}

interface RawStep {
  summary?: unknown;
  reasoning?: unknown;
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

  const rawSteps = Array.isArray(finalPlan.steps) ? (finalPlan.steps as RawStep[]) : [];
  const steps: NormalizedPlanStep[] = rawSteps.map((step, index) =>
    normalizeStep(step, index, facts, selectedAward?.programId),
  );

  const transferStep = steps.find((s) => s.actionType === "transfer");
  const status = typeof finalPlan.status === "string" ? finalPlan.status : undefined;
  const fallback = typeof finalPlan.fallback === "string" ? finalPlan.fallback : null;

  const plan: NormalizedPlan = {
    summary: buildSummary(chosenAwardSlug, selectedAward?.displayName, fallback, steps),
    goalSatisfied: status === "current" && chosenAwardSlug !== undefined,
    transferRequired: transferStep !== undefined,
    ...(transferStep?.points !== undefined ? { transferAmount: transferStep.points } : {}),
    ...(selectedAward ? { selectedProgramId: selectedAward.programId } : {}),
    ...(chosenAwardSlug ? { selectedAwardId: chosenAwardSlug } : {}),
    ...(selectedAward ? { redemptionPoints: selectedAward.pointsRequired } : {}),
    steps,
  };
  return fillImpliedTransferAmounts(plan, facts);
}

/**
 * Fill the implied amount on a transfer step that names a destination matching
 * the selected award's program but omits the number (the graph view carries
 * transfers as edges without amounts; some prose says "transfer to Hyatt" with
 * no figure). The amount is the deterministic deficit: award cost minus the
 * destination program's starting balance. Architecture-independent — the same
 * helper runs for every adapter, so it never flatters one over another. It does
 * NOT add a transfer the plan never expressed.
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

function normalizeStep(
  step: RawStep,
  index: number,
  facts: CanonicalWalletFacts,
  awardProgramId: string | undefined,
): NormalizedPlanStep {
  const summary = typeof step.summary === "string" ? step.summary : `Step ${index + 1}`;
  const reasoning = typeof step.reasoning === "string" ? step.reasoning : undefined;
  const actionType = classifyAction(summary);
  const normalized: NormalizedPlanStep = {
    order: index + 1,
    actionType,
    title: summary,
    ...(reasoning ? { reasoningSummary: reasoning } : {}),
  };

  if (actionType === "transfer") {
    const points = parsePoints(summary);
    if (points !== undefined) normalized.points = points;
    const programs = resolveProgramsInText(summary, facts);
    if (programs.sourceProgramId) normalized.sourceProgramId = programs.sourceProgramId;
    // Prefer an explicit destination mention; fall back to the award's program.
    // Never synthesize a self-route (destination === source): that is not a real
    // transfer and would be wrongly flagged as an unsupported route. Leaving the
    // destination unset makes the evaluator skip the step's route check while the
    // affordability gate still judges the plan honestly.
    const destination = programs.destinationProgramId ?? awardProgramId;
    if (destination && destination !== normalized.sourceProgramId) {
      normalized.destinationProgramId = destination;
    }
  }
  return normalized;
}

// Action keywords grouped by type. A step's action is the type whose keyword
// appears EARLIEST in the prose — the step's actual verb — not whichever type a
// substring happens to match. This prevents an incidental mention ("redeem … after
// the transfer posts", "keep the United option … fewer transferred points") from
// being mis-typed as a transfer just because the word "transfer" appears later.
const ACTION_KEYWORDS: ReadonlyArray<readonly [NormalizedActionType, readonly string[]]> = [
  ["transfer", ["transfer"]],
  ["redeem", ["redeem", "book", "award"]],
  ["fallback", ["cash", "fallback"]],
  ["hold", ["hold", "keep", "wait"]],
];

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

interface ResolvedPrograms {
  sourceProgramId?: string;
  destinationProgramId?: string;
}

// Generic words in program names that must not be used as brand match tokens.
const STOPWORDS = new Set(["ultimate", "rewards", "world", "mileageplus", "of", "the"]);

/**
 * Map program references mentioned in order to source (1st) and dest (2nd).
 * Prose uses short brands ("Chase", "Hyatt") rather than full names ("Chase
 * Ultimate Rewards"), so each program matches on its full name, slug, issuer, or
 * any distinctive (≥4-char, non-stopword) word from its name.
 */
export function resolveProgramsInText(text: string, facts: CanonicalWalletFacts): ResolvedPrograms {
  const lower = text.toLowerCase();
  const mentions: Array<{ index: number; programId: string }> = [];
  for (const program of facts.programs) {
    const earliest = earliestMatch(lower, programMatchTokens(program));
    if (earliest !== -1) mentions.push({ index: earliest, programId: program.programId });
  }
  mentions.sort((a, b) => a.index - b.index);
  const result: ResolvedPrograms = {};
  if (mentions[0]) result.sourceProgramId = mentions[0].programId;
  if (mentions[1]) result.destinationProgramId = mentions[1].programId;
  return result;
}

function programMatchTokens(program: CanonicalWalletFacts["programs"][number]): string[] {
  const brandWords = program.name
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
  return [
    program.name.toLowerCase(),
    program.programSlug.toLowerCase(),
    program.issuer.toLowerCase(),
    ...brandWords,
  ];
}

function earliestMatch(haystack: string, tokens: string[]): number {
  let earliest = -1;
  for (const token of tokens) {
    const at = haystack.indexOf(token);
    if (at !== -1 && (earliest === -1 || at < earliest)) earliest = at;
  }
  return earliest;
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
