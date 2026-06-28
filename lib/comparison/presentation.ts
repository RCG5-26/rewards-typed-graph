/**
 * Pure presentation helpers for the Test Wallets comparison UI. Kept free of
 * React so they can be unit-tested directly and reused across cards.
 */

import type {
  NormalizedActionType,
  PlanEvaluation,
  PublicWalletFacts,
} from "./types";

export function formatPoints(points: number | undefined): string {
  if (points === undefined) return "—";
  return points.toLocaleString("en-US");
}

export function formatLatency(latencyMs: number): string {
  if (latencyMs < 1000) return `${latencyMs} ms`;
  return `${(latencyMs / 1000).toFixed(1)} s`;
}

const ACTION_LABELS: Record<NormalizedActionType, string> = {
  transfer: "Transfer",
  redeem: "Redeem",
  hold: "Hold",
  fallback: "Fallback",
  other: "Step",
};

export function actionLabel(action: NormalizedActionType): string {
  return ACTION_LABELS[action];
}

/** Redemption value in cents-per-point, derived from basis points. */
export function centsPerPoint(valueBasisPoints: number): string {
  return `${(valueBasisPoints / 10000).toFixed(2)}¢/pt`;
}

export function programName(facts: PublicWalletFacts, programId: string | undefined): string {
  if (!programId) return "—";
  const program = facts.programs.find((p) => p.programId === programId);
  return program?.name ?? programId;
}

export function routeRatioLabel(ratioBasisPoints: number): string {
  const ratio = ratioBasisPoints / 10000;
  return ratio === 1 ? "1:1" : `${ratio}:1`;
}

export interface EvaluationCheck {
  label: string;
  ok: boolean;
}

/**
 * The independent, deterministic evaluation surfaced as a checklist. Correctness
 * (goal satisfied) and grounding are kept as separate rows per the freeze.
 */
export function evaluationChecks(evaluation: PlanEvaluation): EvaluationCheck[] {
  return [
    { label: "Goal satisfied", ok: evaluation.goalSatisfied },
    { label: "Affordable", ok: evaluation.affordable },
    { label: "Grounded", ok: evaluation.allAwardReferencesGrounded },
    { label: "Supported route", ok: evaluation.supportedTransferRoute },
    { label: "No negative balance", ok: !evaluation.negativeBalanceCreated },
    { label: "No wasted transfer", ok: !evaluation.unnecessaryTransfer },
  ];
}
