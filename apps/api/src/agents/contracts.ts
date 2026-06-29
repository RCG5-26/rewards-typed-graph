import type { AgentOperation, OperationByAgent } from "../orchestrator/contracts";

export type SpecialistAgentType = "wallet_agent" | "earning_agent" | "redemption_agent";
export type AgentType = "orchestrator" | SpecialistAgentType;

export type UserGoalType =
  | "maximize_points"
  | "maximize_cashback"
  | "specific_redemption"
  | "minimize_fees";

export interface AgentContext<K extends SpecialistAgentType> {
  readonly planId: string;
  readonly userId: string;
  readonly agentRunId: string;
  readonly operation: OperationByAgent[K];
  readonly snapshot: GraphSnapshot;
  readonly commit: AgentCommit;
}

export interface Agent<K extends SpecialistAgentType> {
  readonly agentType: K;
  run(context: AgentContext<K>): Promise<void>;
}

export type AgentRegistry = {
  readonly [K in SpecialistAgentType]: Agent<K>;
};

export type GraphSnapshot = Readonly<{
  userBalances: ReadonlyArray<UserBalanceRow>;
  userGoals: ReadonlyArray<UserGoalRow>;
  userProgramStatuses: ReadonlyArray<UserProgramStatusRow>;
}>;

export interface UserBalanceRow {
  readonly id: string;
  readonly programId: string;
  readonly balancePoints: number;
  readonly version: number;
}

export interface UserGoalRow {
  readonly id: string;
  readonly goalType: UserGoalType;
  readonly targetRedemptionOptionId: string | null;
}

export interface UserProgramStatusRow {
  readonly id: string;
  readonly programId: string;
  readonly statusTier: string;
  readonly version: number;
}

export interface GraphSnapshotBuilder {
  build(input: { userId: string; planId: string }): Promise<GraphSnapshot>;
}

export type ReadSet = Readonly<Record<string, number>>;

export type SpecialistMutationKind =
  | "UpdateUserBalance"
  | "CreatePlanStep"
  | "RecordStateDependency";

export type SpecialistMutation =
  | UpdateUserBalanceMutation
  | CreatePlanStepMutation
  | RecordStateDependencyMutation;

export interface UpdateUserBalanceMutation {
  readonly kind: "UpdateUserBalance";
  readonly balanceNodeId: string;
  readonly balancePoints: number;
}

interface BaseCreatePlanStep {
  readonly kind: "CreatePlanStep";
  readonly planId: string;
  readonly stepOrder: number;
}

export type CreatePlanStepMutation =
  | (BaseCreatePlanStep & {
      readonly stepType: "card_assignment";
      readonly payload: CardAssignmentPayload;
    })
  | (BaseCreatePlanStep & {
      readonly stepType: "spend_analysis";
      readonly payload: SpendAnalysisPayload;
    })
  | (BaseCreatePlanStep & {
      readonly stepType: "redemption_recommendation";
      readonly payload: RedemptionRecommendationPayload;
    })
  | (BaseCreatePlanStep & {
      readonly stepType: "transfer_recommendation";
      readonly payload: TransferRecommendationPayload;
    });

export interface CardAssignmentPayload {
  readonly cardId: string;
}

export interface SpendAnalysisPayload {
  readonly spendCategoryId: string;
  readonly recommendedCardId: string;
}

export interface RedemptionRecommendationPayload {
  readonly redemptionOptionId: string;
  readonly sourceProgramId: string;
  /** Human-readable step title; projected as PlanView step summary. */
  readonly action?: string;
  readonly reasoning?: string;
}

export interface TransferRecommendationPayload {
  readonly fromProgramId: string;
  readonly toProgramId: string;
  /** Human-readable step title; projected as PlanView step summary. */
  readonly action?: string;
  readonly reasoning?: string;
}

export interface RecordStateDependencyMutation {
  readonly kind: "RecordStateDependency";
  readonly planStepId: string;
  readonly targetNodeId: string;
  readonly observedVersion: number;
  readonly target: StateDependencyTarget;
}

export type StateDependencyTarget =
  | {
      readonly targetNodeType: "UserBalance";
      readonly targetTable: "user_balances";
      readonly dependedProperty: "balance_points";
      readonly snapshotValue: { readonly balancePoints: number };
    }
  | {
      readonly targetNodeType: "UserProgramStatus";
      readonly targetTable: "user_program_statuses";
      readonly dependedProperty: "status_tier";
      readonly snapshotValue: { readonly statusTier: string };
    };

export interface AgentCommitFactory {
  create(binding: AgentCommitBinding): AgentCommit;
}

export interface AgentCommitBinding {
  readonly userId: string;
  readonly planId: string;
  readonly agentRunId: string;
  readonly agentType: SpecialistAgentType;
}

export type AgentCommit = (input: AgentCommitInput) => Promise<CommitSuccess>;

export interface AgentCommitInput {
  readonly mutation: SpecialistMutation;
  readonly readSet: ReadSet;
  readonly idempotencyKey: string;
}

export interface CommitSuccess {
  readonly mutationTxnId: string;
  readonly idempotencyReplayed: boolean;
}

export type CommitFailureKind =
  | "ValidationError"
  | "OwnershipError"
  | "ConflictError"
  | "IdempotencyConflict"
  | "UnexpectedCommitError";

export class CommitFailure extends Error {
  constructor(
    readonly kind: CommitFailureKind,
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "CommitFailure";
  }
}
