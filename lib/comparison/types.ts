/**
 * Web-shell mirror of the normalized comparison contract.
 *
 * Hand-mirrored superset of `apps/api/src/comparison/types.ts` (the repo has no
 * shared TS workspace — ADR 0007 / freeze §5). The Next.js shell consumes
 * already-validated API responses, so this file carries the types plus a thin
 * presentation guard, not the full runtime validator.
 *
 * Keep field names identical to the API contract so the wire shape round-trips
 * with zero adaptation.
 */

export type ArchitectureVariant = "live-graph-orchestrator" | "chat-crew" | "single-agent";

export type ArchitectureRunStatus =
  | "not_started"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out";

export type NormalizedActionType = "transfer" | "redeem" | "hold" | "fallback" | "other";

export interface NormalizedPlanStep {
  order: number;
  actionType: NormalizedActionType;
  title: string;
  sourceProgramId?: string;
  destinationProgramId?: string;
  points?: number;
  awardId?: string;
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
  allAwardReferencesGrounded: boolean;
  negativeBalanceCreated: boolean;
  unnecessaryTransfer: boolean;
  issues: EvaluationIssue[];
}

export interface ArchitectureMetrics {
  latencyMs: number;
  model?: string;
  modelCalls?: number;
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
  walletId: string;
  walletVersion: string;
  query: string;
  plan?: NormalizedPlan;
  evaluation?: PlanEvaluation;
  metrics: ArchitectureMetrics;
  evidence?: ArchitectureEvidence;
  error?: ArchitectureRunError;
}

export interface ArchitectureComparisonResponse {
  walletId: string;
  walletVersion: string;
  query: string;
  results: ArchitectureComparisonResult[];
}

/** Human-readable label for each architecture variant (UI card headers). */
export const VARIANT_LABELS: Record<ArchitectureVariant, string> = {
  "live-graph-orchestrator": "Graph Crew",
  "chat-crew": "Chat Crew",
  "single-agent": "Single Agent",
};

// ---------------------------------------------------------------------------
// Public wallet facts (GET /demo/test-wallets). Mirror of the API's
// CanonicalWalletFacts — the public facts shown before any run. No private gold.
// ---------------------------------------------------------------------------

export interface PublicCard {
  cardId: string;
  cardName: string;
  issuer: string;
  programId: string;
  programName: string;
}

export interface PublicBalance {
  programId: string;
  programSlug: string;
  programName: string;
  points: number;
  version: number;
}

export interface PublicTransferRoute {
  sourceProgramId: string;
  sourceProgramSlug: string;
  destinationProgramId: string;
  destinationProgramSlug: string;
  ratioBasisPoints: number;
}

export interface PublicAwardOption {
  awardId: string;
  awardSlug: string;
  displayName: string;
  programId: string;
  programSlug: string;
  pointsRequired: number;
  valueBasisPoints: number;
  available: boolean;
}

export interface PublicWalletFacts {
  walletId: string;
  version: string;
  displayName: string;
  description: string;
  programs: Array<{ programId: string; programSlug: string; name: string; issuer: string }>;
  cards: PublicCard[];
  balances: PublicBalance[];
  transferRoutes: PublicTransferRoute[];
  awardOptions: PublicAwardOption[];
  goal: { destination: string; category: string; nights: number };
  query: string;
}

export interface TestWalletsResponse {
  wallets: PublicWalletFacts[];
}

/** Mirror of `apps/api/src/comparison/simulate-transfer.ts` response. */
export interface DemoSimulateTransferResponse {
  walletId: string;
  walletVersion: string;
  idempotencyReplayed: boolean;
  transfer: {
    sourceProgramId: string;
    destProgramId: string;
    amountPoints: number;
  };
  replanJobId: string | null;
  staledPlanId: string | null;
  currentPlan: {
    planId: string;
    planLineageId: string;
    revisionNumber: number;
    status: string;
    query: string;
    summary: string | null;
    steps: Array<{ order: number; type: string; summary: string; status: string }>;
  };
  graphResult: ArchitectureComparisonResult;
}
