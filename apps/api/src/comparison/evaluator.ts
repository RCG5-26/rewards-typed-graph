/**
 * Deterministic, architecture-blind plan evaluator (demo sprint Step 6).
 *
 * Pure function: `(NormalizedPlan, CanonicalWalletFacts) → PlanEvaluation`. It
 * never calls an LLM, never knows which architecture produced the plan, and
 * never ranks on prose. Hard-validity gates and a lexicographic ranking are the
 * only judgments — same input always yields the same output (freeze §8).
 *
 * The evaluator simulates the wallet: it applies the plan's transfer steps to a
 * copy of the canonical balances, then checks whether the selected award is
 * affordable from the resulting balance. This lets it independently confirm or
 * refute a plan's `goalSatisfied` claim instead of trusting it.
 */

import {
  type CanonicalAwardOption,
  type CanonicalWalletFacts,
  knownAwardIdentifiers,
  knownProgramIdentifiers,
} from "./canonical-wallet";
import type { EvaluationIssue, NormalizedPlan, NormalizedPlanStep, PlanEvaluation } from "./types";

/** A plan paired with its evaluation — the unit the ranking operates on. */
export interface EvaluatedPlan {
  plan: NormalizedPlan;
  evaluation: PlanEvaluation;
}

export function evaluatePlan(plan: NormalizedPlan, facts: CanonicalWalletFacts): PlanEvaluation {
  const issues: EvaluationIssue[] = [];

  const structurallyValid = checkStructure(plan, issues);
  const allAwardReferencesGrounded = checkGrounding(plan, facts, issues);
  const supportedTransferRoute = checkTransferRoutes(plan, facts, issues);
  const simulation = simulateBalances(plan, facts, issues);
  const negativeBalanceCreated = simulation.negativeBalanceCreated;

  const selectedAward = findSelectedAward(plan, facts);
  const affordable = checkAffordable(plan, selectedAward, simulation, issues);
  const unnecessaryTransfer = checkUnnecessaryTransfer(plan, selectedAward, facts, issues);

  const goalSatisfied = checkGoalSatisfied(
    plan,
    selectedAward,
    { affordable, allAwardReferencesGrounded },
    issues,
  );

  return {
    structurallyValid,
    goalSatisfied,
    affordable,
    supportedTransferRoute,
    allAwardReferencesGrounded,
    negativeBalanceCreated,
    unnecessaryTransfer,
    issues,
  };
}

/** A plan is hard-valid iff no error-severity gate failed. */
export function isHardValid(evaluation: PlanEvaluation): boolean {
  return !evaluation.issues.some((issue) => issue.severity === "error");
}

// ---------------------------------------------------------------------------
// Individual gates
// ---------------------------------------------------------------------------

function checkStructure(plan: NormalizedPlan, issues: EvaluationIssue[]): boolean {
  let valid = true;
  const orders = plan.steps.map((s) => s.order);
  if (new Set(orders).size !== orders.length) {
    issues.push(error("malformed_steps", "plan steps have duplicate order values"));
    valid = false;
  }
  // A redemption that claims the goal but lists no steps is contradictory.
  if (plan.goalSatisfied && plan.steps.length === 0 && !plan.selectedAwardId) {
    issues.push(error("malformed_steps", "plan claims the goal with no steps and no selected award"));
    valid = false;
  }
  return valid;
}

function checkGrounding(
  plan: NormalizedPlan,
  facts: CanonicalWalletFacts,
  issues: EvaluationIssue[],
): boolean {
  const awardIds = knownAwardIdentifiers(facts);
  const programIds = knownProgramIdentifiers(facts);
  let grounded = true;

  const citedAwards = [plan.selectedAwardId, ...plan.steps.map((s) => s.awardId)].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  for (const id of citedAwards) {
    if (!awardIds.has(id)) {
      issues.push(error("award_not_grounded", `award reference not in supplied facts: ${id}`));
      grounded = false;
    }
  }

  const citedPrograms = [
    plan.selectedProgramId,
    ...plan.steps.flatMap((s) => [s.sourceProgramId, s.destinationProgramId]),
  ].filter((id): id is string => typeof id === "string" && id.length > 0);
  for (const id of citedPrograms) {
    if (!programIds.has(id)) {
      issues.push(error("program_not_grounded", `program reference not in supplied facts: ${id}`));
      grounded = false;
    }
  }
  return grounded;
}

function checkTransferRoutes(
  plan: NormalizedPlan,
  facts: CanonicalWalletFacts,
  issues: EvaluationIssue[],
): boolean {
  const routes = new Set(
    facts.transferRoutes.flatMap((r) => [
      `${r.sourceProgramId}->${r.destinationProgramId}`,
      `${r.sourceProgramSlug}->${r.destinationProgramSlug}`,
    ]),
  );
  let supported = true;
  for (const step of plan.steps) {
    if (step.actionType !== "transfer") continue;
    if (!step.sourceProgramId || !step.destinationProgramId) continue;
    const key = `${step.sourceProgramId}->${step.destinationProgramId}`;
    if (!routes.has(key)) {
      issues.push(error("unsupported_transfer_route", `transfer route not supported: ${key}`));
      supported = false;
    }
  }
  return supported;
}

interface Simulation {
  /** Resulting balance per program, keyed by both UUID and slug. */
  balanceByProgram: Map<string, number>;
  negativeBalanceCreated: boolean;
}

/**
 * Apply the plan's transfer steps to a copy of the canonical balances (pure; no
 * issue recording). A transfer deducts `points` from the source and credits the
 * destination at the route's ratio (1:1 in the canonical wallet). Used by both
 * the affordability gate and the ranking's flexible-points tie-break.
 */
function simulateFinalBalances(plan: NormalizedPlan, facts: CanonicalWalletFacts): Simulation {
  const byId = new Map<string, number>();
  const slugForId = new Map<string, string>();
  for (const balance of facts.balances) {
    byId.set(balance.programId, balance.points);
    slugForId.set(balance.programId, balance.programSlug);
  }
  const idForAny = buildProgramIdResolver(facts);
  const ratioFor = buildRatioResolver(facts);

  let negativeBalanceCreated = false;
  for (const step of plan.steps) {
    if (step.actionType !== "transfer") continue;
    const amount = step.points ?? 0;
    const sourceId = idForAny(step.sourceProgramId);
    const destId = idForAny(step.destinationProgramId);
    if (sourceId) {
      const next = (byId.get(sourceId) ?? 0) - amount;
      byId.set(sourceId, next);
      if (next < 0) negativeBalanceCreated = true;
    }
    if (destId) {
      const ratio = sourceId && destId ? ratioFor(sourceId, destId) : 1;
      byId.set(destId, (byId.get(destId) ?? 0) + Math.round(amount * ratio));
    }
  }

  const balanceByProgram = new Map<string, number>();
  for (const [id, points] of byId) {
    balanceByProgram.set(id, points);
    const slug = slugForId.get(id);
    if (slug) balanceByProgram.set(slug, points);
  }
  return { balanceByProgram, negativeBalanceCreated };
}

function simulateBalances(
  plan: NormalizedPlan,
  facts: CanonicalWalletFacts,
  issues: EvaluationIssue[],
): Simulation {
  const simulation = simulateFinalBalances(plan, facts);
  if (simulation.negativeBalanceCreated) {
    issues.push(error("negative_balance", "a transfer drives a program balance below zero"));
  }
  return simulation;
}

function checkAffordable(
  plan: NormalizedPlan,
  selectedAward: CanonicalAwardOption | undefined,
  simulation: Simulation,
  issues: EvaluationIssue[],
): boolean {
  if (!selectedAward) {
    // No grounded selected award: affordability is undefined → treat as not affordable
    // only if the plan claims a redemption. A pure cash-fallback plan is affordable.
    return plan.selectedAwardId === undefined;
  }
  const available =
    simulation.balanceByProgram.get(selectedAward.programId) ??
    simulation.balanceByProgram.get(selectedAward.programSlug) ??
    0;
  if (available < selectedAward.pointsRequired) {
    issues.push(
      error(
        "overspend",
        `selected award costs ${selectedAward.pointsRequired} but only ${available} available in ${selectedAward.programSlug}`,
      ),
    );
    return false;
  }
  return true;
}

function checkUnnecessaryTransfer(
  plan: NormalizedPlan,
  selectedAward: CanonicalAwardOption | undefined,
  facts: CanonicalWalletFacts,
  issues: EvaluationIssue[],
): boolean {
  if (!selectedAward) return false;
  const hasTransferIntoAwardProgram = plan.steps.some(
    (s) =>
      s.actionType === "transfer" &&
      destinationMatchesProgram(s, selectedAward, facts),
  );
  if (!hasTransferIntoAwardProgram) return false;

  const startingBalance = facts.balances.find(
    (b) => b.programId === selectedAward.programId,
  )?.points ?? 0;
  if (startingBalance >= selectedAward.pointsRequired) {
    issues.push(
      warning(
        "unnecessary_transfer",
        `${selectedAward.programSlug} already held ${startingBalance} ≥ ${selectedAward.pointsRequired}; the transfer was not needed`,
      ),
    );
    return true;
  }
  return false;
}

function checkGoalSatisfied(
  plan: NormalizedPlan,
  selectedAward: CanonicalAwardOption | undefined,
  gates: { affordable: boolean; allAwardReferencesGrounded: boolean },
  issues: EvaluationIssue[],
): boolean {
  const actuallySatisfied =
    selectedAward !== undefined &&
    selectedAward.available &&
    gates.affordable &&
    gates.allAwardReferencesGrounded;

  if (plan.goalSatisfied && !actuallySatisfied) {
    issues.push(
      error(
        "goal_falsely_claimed",
        "plan claims the goal is satisfied but the selected award is not grounded/affordable/available",
      ),
    );
  }
  return actuallySatisfied;
}

// ---------------------------------------------------------------------------
// Ranking — lexicographic, no weighted score (freeze §8)
// ---------------------------------------------------------------------------

/**
 * Compare two evaluated plans. Returns <0 if `a` should rank before `b`.
 * Order: goal satisfaction → feasibility → redemption value → fewer
 * unnecessary transfers → fewer steps → more preserved flexible points.
 *
 * `facts` is needed to derive the redemption value and the flexible-points
 * tie-break (both come from the canonical wallet, not the plan object).
 */
export function comparePlans(a: EvaluatedPlan, b: EvaluatedPlan, facts: CanonicalWalletFacts): number {
  const byGoal = score(b.evaluation.goalSatisfied) - score(a.evaluation.goalSatisfied);
  if (byGoal !== 0) return byGoal;

  const byFeasible = score(feasible(b.evaluation)) - score(feasible(a.evaluation));
  if (byFeasible !== 0) return byFeasible;

  const byValue = redemptionValue(b.plan, facts) - redemptionValue(a.plan, facts);
  if (byValue !== 0) return byValue;

  const byNeededTransfer =
    score(a.evaluation.unnecessaryTransfer) - score(b.evaluation.unnecessaryTransfer);
  if (byNeededTransfer !== 0) return byNeededTransfer;

  const bySteps = executableStepCount(a.plan) - executableStepCount(b.plan);
  if (bySteps !== 0) return bySteps;

  return flexiblePointsPreserved(b.plan, facts) - flexiblePointsPreserved(a.plan, facts);
}

export function rankPlans(plans: EvaluatedPlan[], facts: CanonicalWalletFacts): EvaluatedPlan[] {
  return [...plans].sort((a, b) => comparePlans(a, b, facts));
}

/** Selected award's redemption value in basis points (0 when no grounded award). */
function redemptionValue(plan: NormalizedPlan, facts: CanonicalWalletFacts): number {
  return findSelectedAward(plan, facts)?.valueBasisPoints ?? 0;
}

/**
 * Flexible (transferable, non-hotel/non-airline) points preserved after the
 * plan runs — the tie-break that rewards keeping options open. The canonical
 * transferable program is Chase Ultimate Rewards.
 */
function flexiblePointsPreserved(plan: NormalizedPlan, facts: CanonicalWalletFacts): number {
  const simulation = simulateFinalBalances(plan, facts);
  const flexible = facts.programs.find((p) => p.issuer === "Chase" && p.programSlug === "program:chase_ur");
  if (!flexible) return 0;
  return simulation.balanceByProgram.get(flexible.programId) ?? 0;
}

function feasible(evaluation: PlanEvaluation): boolean {
  return (
    evaluation.affordable &&
    evaluation.supportedTransferRoute &&
    !evaluation.negativeBalanceCreated &&
    evaluation.allAwardReferencesGrounded
  );
}

function executableStepCount(plan: NormalizedPlan): number {
  return plan.steps.filter((s) => s.actionType !== "hold" && s.actionType !== "other").length;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findSelectedAward(
  plan: NormalizedPlan,
  facts: CanonicalWalletFacts,
): CanonicalAwardOption | undefined {
  if (!plan.selectedAwardId) return undefined;
  return facts.awardOptions.find(
    (a) => a.awardId === plan.selectedAwardId || a.awardSlug === plan.selectedAwardId,
  );
}

function buildProgramIdResolver(facts: CanonicalWalletFacts): (value: string | undefined) => string | undefined {
  const toId = new Map<string, string>();
  for (const program of facts.programs) {
    toId.set(program.programId, program.programId);
    toId.set(program.programSlug, program.programId);
  }
  return (value) => (value ? toId.get(value) : undefined);
}

function buildRatioResolver(facts: CanonicalWalletFacts): (sourceId: string, destId: string) => number {
  const ratios = new Map<string, number>();
  for (const route of facts.transferRoutes) {
    ratios.set(`${route.sourceProgramId}->${route.destinationProgramId}`, route.ratioBasisPoints / 10000);
  }
  return (sourceId, destId) => ratios.get(`${sourceId}->${destId}`) ?? 1;
}

function destinationMatchesProgram(
  step: NormalizedPlanStep,
  award: CanonicalAwardOption,
  facts: CanonicalWalletFacts,
): boolean {
  const resolve = buildProgramIdResolver(facts);
  return resolve(step.destinationProgramId) === award.programId;
}

function error(code: string, message: string): EvaluationIssue {
  return { code, message, severity: "error" };
}

function warning(code: string, message: string): EvaluationIssue {
  return { code, message, severity: "warning" };
}

function score(value: boolean): number {
  return value ? 1 : 0;
}
