/**
 * Normalized three-architecture comparison contract (demo sprint, Person B lane).
 *
 * This is the single narrow waist every architecture is projected through before
 * it is evaluated or shown to the user. The graph orchestrator (`PlanView`), the
 * free-text chat crew, and the single-agent baseline each have very different
 * native outputs; their adapters normalize all of them into {@link NormalizedPlan}
 * so the evaluator is architecture-blind and the UI renders three identical cards.
 *
 * Frozen in `docs/demo/DEMO_SPRINT_FREEZE.md` §6. This file is the code-level
 * source of truth; `lib/comparison/types.ts` is a hand-mirrored superset for the
 * Next.js shell (the repo has no shared TS workspace — see ADR 0007).
 *
 * Contract rules (do not weaken):
 *  - correctness ≠ grounding: `goalSatisfied` and `allAwardReferencesGrounded`
 *    are independent fields. A correct award with unsupported provenance is
 *    representable (`goalSatisfied:true` + `allAwardReferencesGrounded:false`).
 *  - unknown metrics stay `undefined` — never fabricate `0` tokens.
 *  - `reasoningSummary` is a user-facing summary ONLY, never chain-of-thought.
 *  - evidence is architecture-specific and entirely optional.
 */

export type ArchitectureVariant = "live-graph-orchestrator" | "chat-crew" | "single-agent";

export const ARCHITECTURE_VARIANTS: readonly ArchitectureVariant[] = [
  "live-graph-orchestrator",
  "chat-crew",
  "single-agent",
];

export type ArchitectureRunStatus =
  | "not_started"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out";

export type NormalizedActionType = "transfer" | "redeem" | "hold" | "fallback" | "other";

export const NORMALIZED_ACTION_TYPES: readonly NormalizedActionType[] = [
  "transfer",
  "redeem",
  "hold",
  "fallback",
  "other",
];

export interface NormalizedPlanStep {
  order: number;
  actionType: NormalizedActionType;
  title: string;
  sourceProgramId?: string;
  destinationProgramId?: string;
  points?: number;
  awardId?: string;
  /** User-facing summary ONLY — never chain-of-thought. */
  reasoningSummary?: string;
}

export interface NormalizedPlan {
  summary: string;
  goalSatisfied: boolean;
  transferRequired: boolean;
  transferAmount?: number;
  selectedProgramId?: string;
  selectedAwardId?: string;
  redemptionPoints?: number;
  steps: NormalizedPlanStep[];
}

export type EvaluationIssueSeverity = "error" | "warning";

export interface EvaluationIssue {
  code: string;
  message: string;
  severity: EvaluationIssueSeverity;
}

export interface PlanEvaluation {
  structurallyValid: boolean;
  goalSatisfied: boolean;
  affordable: boolean;
  supportedTransferRoute: boolean;
  /** Independent of recommendation correctness — every cited id is in supplied facts. */
  allAwardReferencesGrounded: boolean;
  negativeBalanceCreated: boolean;
  unnecessaryTransfer: boolean;
  issues: EvaluationIssue[];
}

export interface ArchitectureMetrics {
  latencyMs: number;
  model?: string;
  modelCalls?: number;
  /** undefined when unknown — NEVER fabricate 0. */
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ArchitectureEvidence {
  agentTypes?: string[];
  handoffCount?: number;
  dependencyCount?: number;
  agentRunCount?: number;
  revisionNumber?: number;
  planId?: string;
  lineageId?: string;
  citedAwardIds?: string[];
  availableAwardIds?: string[];
}

export interface ArchitectureRunError {
  category: string;
  message: string;
}

export interface ArchitectureComparisonResult {
  variant: ArchitectureVariant;
  status: ArchitectureRunStatus;
  /** Canonical approved wallet id (e.g. "transfer-required"). */
  walletId: string;
  /** Canonical fixture version (e.g. "demo-seed-v1"). */
  walletVersion: string;
  /** The canonical query, verbatim. */
  query: string;
  plan?: NormalizedPlan;
  evaluation?: PlanEvaluation;
  metrics: ArchitectureMetrics;
  evidence?: ArchitectureEvidence;
  error?: ArchitectureRunError;
}

/**
 * The top-level endpoint response (`POST /demo/architecture-comparison`). All
 * three results are always present; an individual variant may carry a `failed`
 * status with an `error` while the others succeed.
 */
export interface ArchitectureComparisonResponse {
  walletId: string;
  walletVersion: string;
  query: string;
  results: ArchitectureComparisonResult[];
}

// ---------------------------------------------------------------------------
// Runtime validation. The contract is consumed across a process boundary (the
// Python baselines), so a runtime guard — not just a compile-time type — gates
// every result before it is evaluated or serialized.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isArchitectureVariant(value: unknown): value is ArchitectureVariant {
  return typeof value === "string" && (ARCHITECTURE_VARIANTS as readonly string[]).includes(value);
}

export function isArchitectureRunStatus(value: unknown): value is ArchitectureRunStatus {
  return (
    value === "not_started" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "timed_out"
  );
}

export function isNormalizedActionType(value: unknown): value is NormalizedActionType {
  return typeof value === "string" && (NORMALIZED_ACTION_TYPES as readonly string[]).includes(value);
}

/**
 * Validate an {@link ArchitectureComparisonResult}, returning the list of
 * problems (empty = valid). Returning issues rather than a boolean lets callers
 * surface *why* an adapter produced a malformed result instead of a bare false.
 */
export function validateComparisonResult(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return ["result is not an object"];
  }
  if (!isArchitectureVariant(value.variant)) issues.push("invalid variant");
  if (!isArchitectureRunStatus(value.status)) issues.push("invalid status");
  if (typeof value.walletId !== "string" || value.walletId.length === 0) {
    issues.push("walletId must be a non-empty string");
  }
  if (typeof value.walletVersion !== "string" || value.walletVersion.length === 0) {
    issues.push("walletVersion must be a non-empty string");
  }
  if (typeof value.query !== "string" || value.query.length === 0) {
    issues.push("query must be a non-empty string");
  }
  if (!isRecord(value.metrics) || typeof value.metrics.latencyMs !== "number") {
    issues.push("metrics.latencyMs must be a number");
  }
  if (value.plan !== undefined) {
    issues.push(...validateNormalizedPlan(value.plan).map((m) => `plan: ${m}`));
  }
  // A succeeded run must carry a plan; a failed run must carry an error.
  if (value.status === "succeeded" && value.plan === undefined) {
    issues.push("succeeded result must include a plan");
  }
  if (value.status === "failed" && !isRecord(value.error)) {
    issues.push("failed result must include an error");
  }
  return issues;
}

export function validateNormalizedPlan(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value)) {
    return ["plan is not an object"];
  }
  if (typeof value.summary !== "string") issues.push("summary must be a string");
  if (typeof value.goalSatisfied !== "boolean") issues.push("goalSatisfied must be a boolean");
  if (typeof value.transferRequired !== "boolean") issues.push("transferRequired must be a boolean");
  if (!Array.isArray(value.steps)) {
    issues.push("steps must be an array");
  } else {
    value.steps.forEach((step, index) => {
      if (!isRecord(step)) {
        issues.push(`step[${index}] is not an object`);
        return;
      }
      if (typeof step.order !== "number") issues.push(`step[${index}].order must be a number`);
      if (!isNormalizedActionType(step.actionType)) issues.push(`step[${index}].actionType invalid`);
      if (typeof step.title !== "string") issues.push(`step[${index}].title must be a string`);
    });
  }
  return issues;
}

export function isValidComparisonResult(value: unknown): value is ArchitectureComparisonResult {
  return validateComparisonResult(value).length === 0;
}
