import type {
  AgentCommitFactory,
  AgentRegistry,
  AgentType,
  GraphSnapshotBuilder,
  UserGoalType,
} from "../agents/contracts";

export interface PlanRequest {
  readonly userId: string;
  readonly queryText: string;
}

export interface PlanResult {
  readonly planId: string;
  readonly planLineageId: string;
  readonly status: "current" | "failed";
  readonly agentRunIds: readonly string[];
}

export interface Decomposer {
  decompose(queryText: string): Promise<unknown>;
}

export interface DecomposedQuery {
  readonly invocations: readonly AgentInvocation[];
}

export type AgentInvocation =
  | { readonly agentType: "wallet_agent"; readonly operation: WalletAssessmentOperation }
  | { readonly agentType: "earning_agent"; readonly operation: EarningRecommendationOperation }
  | { readonly agentType: "redemption_agent"; readonly operation: RedemptionTraversalOperation };

export type AgentOperation =
  | WalletAssessmentOperation
  | EarningRecommendationOperation
  | RedemptionTraversalOperation;

export interface OperationByAgent {
  readonly wallet_agent: WalletAssessmentOperation;
  readonly earning_agent: EarningRecommendationOperation;
  readonly redemption_agent: RedemptionTraversalOperation;
}

export interface WalletAssessmentOperation {
  readonly kind: "assess_wallet";
  readonly agentType: "wallet_agent";
  readonly programIds: readonly string[];
}

export interface EarningRecommendationOperation {
  readonly kind: "recommend_earning";
  readonly agentType: "earning_agent";
  readonly spendCategoryIds: readonly string[];
}

export interface RedemptionTraversalOperation {
  readonly kind: "traverse_redemption";
  readonly agentType: "redemption_agent";
  readonly goalType: UserGoalType;
  readonly targetRedemptionOptionId: string | null;
  readonly sourceProgramIds: readonly string[];
}

export interface OrchestratorGraphWrite {
  createPlan(input: {
    userId: string;
    planLineageId: string;
    queryText: string;
  }): Promise<PlanRecord>;
  transitionPlanStatus(input: { planId: string; toStatus: "current" | "failed" }): Promise<void>;
  createAgentRun(input: {
    planId: string;
    userId: string;
    agentType: AgentType;
  }): Promise<AgentRunRecord>;
  finalizeAgentRun(input: {
    agentRunId: string;
    status: "completed" | "failed";
    error?: string;
  }): Promise<void>;
}

export interface PlanRecord {
  readonly id: string;
  readonly planLineageId: string;
  readonly revisionNumber: number;
  readonly queryText: string;
  readonly status: "generating" | "current" | "failed";
  readonly planType: "agent_generated";
}

export interface AgentRunRecord {
  readonly id: string;
  readonly agentType: AgentType;
  readonly planId: string;
  readonly userId: string;
  readonly status: "running" | "completed" | "failed";
  readonly state: { last_read_versions: Record<string, number> } | null;
  readonly error: string | null;
}

export type OrchestrationErrorKind = "DecompositionInvalid";

export class OrchestrationError extends Error {
  constructor(
    readonly kind: OrchestrationErrorKind,
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "OrchestrationError";
  }
}

export interface OrchestratorDeps {
  readonly decomposer: Decomposer;
  readonly graphWrite: OrchestratorGraphWrite;
  readonly snapshotBuilder: GraphSnapshotBuilder;
  readonly agentRegistry: AgentRegistry;
  readonly commitFactory: AgentCommitFactory;
}
