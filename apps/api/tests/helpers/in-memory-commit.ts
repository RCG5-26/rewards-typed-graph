import { isOwnedBy } from "../../src/agents/ownership";
import type {
  AgentCommit,
  AgentCommitBinding,
  AgentCommitFactory,
  AgentCommitInput,
  CommitSuccess,
  CreatePlanStepMutation,
  ReadSet,
  SpecialistMutation,
  SpecialistMutationKind,
} from "../../src/agents/contracts";
import { CommitFailure } from "../../src/agents/contracts";
import type { InMemoryOrchestratorGraphWrite } from "./in-memory-graph-write";

export class ThrowingCommitFactory implements AgentCommitFactory {
  constructor(private readonly error: Error) {}

  create(_binding: AgentCommitBinding): AgentCommit {
    throw this.error;
  }
}

export interface RecordedCommit {
  readonly mutation: SpecialistMutation;
  readonly readSet: ReadSet;
  readonly idempotencyKey: string;
  readonly agentRunId: string;
  readonly agentType: AgentCommitBinding["agentType"];
}

function stableFingerprint(mutation: SpecialistMutation): string {
  return JSON.stringify(mutation, (_, val: unknown) =>
    val !== null && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort())
      : val,
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateReadSet(readSet: ReadSet): void {
  for (const [nodeId, version] of Object.entries(readSet)) {
    if (!isNonEmptyString(nodeId)) {
      throw new CommitFailure("ValidationError", "readSet contains empty node id");
    }
    if (!Number.isInteger(version) || version < 0) {
      throw new CommitFailure("ValidationError", `invalid readSet version for ${nodeId}`);
    }
  }
}

function validateCreatePlanStep(mutation: CreatePlanStepMutation): void {
  if (!isNonEmptyString(mutation.planId)) {
    throw new CommitFailure("ValidationError", "CreatePlanStep requires planId");
  }
  if (!Number.isInteger(mutation.stepOrder) || mutation.stepOrder < 1) {
    throw new CommitFailure("ValidationError", "CreatePlanStep requires stepOrder >= 1");
  }
  switch (mutation.stepType) {
    case "card_assignment":
      if (!isNonEmptyString(mutation.payload.cardId)) {
        throw new CommitFailure("ValidationError", "card_assignment requires cardId");
      }
      break;
    case "spend_analysis":
      if (
        !isNonEmptyString(mutation.payload.spendCategoryId) ||
        !isNonEmptyString(mutation.payload.recommendedCardId)
      ) {
        throw new CommitFailure(
          "ValidationError",
          "spend_analysis requires spendCategoryId and recommendedCardId",
        );
      }
      break;
    case "redemption_recommendation":
      if (
        !isNonEmptyString(mutation.payload.redemptionOptionId) ||
        !isNonEmptyString(mutation.payload.sourceProgramId)
      ) {
        throw new CommitFailure(
          "ValidationError",
          "redemption_recommendation requires redemptionOptionId and sourceProgramId",
        );
      }
      break;
    case "transfer_recommendation":
      if (
        !isNonEmptyString(mutation.payload.fromProgramId) ||
        !isNonEmptyString(mutation.payload.toProgramId)
      ) {
        throw new CommitFailure(
          "ValidationError",
          "transfer_recommendation requires fromProgramId and toProgramId",
        );
      }
      break;
    default: {
      const _exhaustive: never = mutation;
      throw new CommitFailure(
        "ValidationError",
        `unknown stepType: ${(_exhaustive as CreatePlanStepMutation).stepType}`,
      );
    }
  }
}

function validateMutationStructure(mutation: SpecialistMutation): void {
  const knownKinds: readonly SpecialistMutationKind[] = [
    "UpdateUserBalance",
    "CreatePlanStep",
    "RecordStateDependency",
  ];
  if (!knownKinds.includes(mutation.kind)) {
    throw new CommitFailure(
      "ValidationError",
      `unknown mutation kind: ${(mutation as { kind: string }).kind}`,
    );
  }

  switch (mutation.kind) {
    case "UpdateUserBalance":
      if (!isNonEmptyString(mutation.balanceNodeId)) {
        throw new CommitFailure("ValidationError", "UpdateUserBalance requires balanceNodeId");
      }
      break;
    case "CreatePlanStep":
      validateCreatePlanStep(mutation);
      break;
    case "RecordStateDependency":
      if (
        !isNonEmptyString(mutation.planStepId) ||
        !isNonEmptyString(mutation.targetNodeId) ||
        !Number.isInteger(mutation.observedVersion) ||
        mutation.observedVersion < 0
      ) {
        throw new CommitFailure(
          "ValidationError",
          "RecordStateDependency requires planStepId, targetNodeId, observedVersion",
        );
      }
      if (
        mutation.target.targetNodeType !== "UserBalance" &&
        mutation.target.targetNodeType !== "UserProgramStatus"
      ) {
        throw new CommitFailure("ValidationError", "unknown StateDependencyTarget variant");
      }
      break;
    default: {
      const _exhaustive: never = mutation;
      throw new CommitFailure(
        "ValidationError",
        `unhandled mutation: ${(_exhaustive as SpecialistMutation).kind}`,
      );
    }
  }
}

export class InMemoryAgentCommitFactory implements AgentCommitFactory {
  readonly recordedCommits: RecordedCommit[] = [];
  private readonly idempotencyStore = new Map<
    string,
    { fingerprint: string; result: CommitSuccess }
  >();
  private failCheckpointOnce = false;
  private failCheckpointOnNthRecord: number | null = null;
  private recordAttempt = 0;

  constructor(private readonly graphWrite: InMemoryOrchestratorGraphWrite) {}

  setFailCheckpointOnce(value: boolean): void {
    this.failCheckpointOnce = value;
  }

  setFailCheckpointOnNthRecord(n: number): void {
    this.failCheckpointOnNthRecord = n;
    this.recordAttempt = 0;
  }

  create(binding: AgentCommitBinding): AgentCommit {
    const { userId, planId, agentRunId, agentType } = binding;

    return async (input: AgentCommitInput): Promise<CommitSuccess> => {
      void userId;
      void planId;

      if (!isNonEmptyString(input.idempotencyKey)) {
        throw new CommitFailure("ValidationError", "idempotencyKey must be a non-empty string");
      }

      validateReadSet(input.readSet);

      try {
        validateMutationStructure(input.mutation);
      } catch (err) {
        if (err instanceof CommitFailure) throw err;
        throw new CommitFailure("ValidationError", "mutation validation failed");
      }

      if (!isOwnedBy(agentType, input.mutation.kind)) {
        throw new CommitFailure(
          "OwnershipError",
          `${agentType} cannot submit ${input.mutation.kind}`,
        );
      }

      if (input.mutation.kind === "CreatePlanStep" && input.mutation.planId !== planId) {
        throw new CommitFailure(
          "ValidationError",
          "CreatePlanStep planId does not match bound plan",
        );
      }

      const fingerprint = stableFingerprint(input.mutation);
      const prior = this.idempotencyStore.get(input.idempotencyKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint) {
          throw new CommitFailure(
            "IdempotencyConflict",
            "idempotency key reused with different request",
          );
        }
        return { ...prior.result, idempotencyReplayed: true };
      }

      const mutationTxnId = crypto.randomUUID();
      const snapshotBefore = structuredClone(this.graphWrite.agentRuns.get(agentRunId)?.state);

      this.recordAttempt += 1;
      const shouldFailCheckpoint =
        this.failCheckpointOnce ||
        (this.failCheckpointOnNthRecord !== null &&
          this.recordAttempt === this.failCheckpointOnNthRecord);

      this.recordedCommits.push({
        mutation: input.mutation,
        readSet: input.readSet,
        idempotencyKey: input.idempotencyKey,
        agentRunId,
        agentType,
      });

      try {
        if (shouldFailCheckpoint) {
          this.failCheckpointOnce = false;
          throw new CommitFailure("UnexpectedCommitError", "checkpoint merge failed");
        }
        this.graphWrite.mergeReadCheckpoint(agentRunId, input.readSet);
      } catch (err) {
        this.recordedCommits.pop();
        const run = this.graphWrite.agentRuns.get(agentRunId);
        if (run) {
          this.graphWrite.agentRuns.set(agentRunId, {
            ...run,
            state: snapshotBefore ?? null,
          });
        }
        if (err instanceof CommitFailure) throw err;
        throw new CommitFailure("UnexpectedCommitError", "atomic write failed");
      }

      const result: CommitSuccess = { mutationTxnId, idempotencyReplayed: false };
      this.idempotencyStore.set(input.idempotencyKey, { fingerprint, result });
      return result;
    };
  }
}
