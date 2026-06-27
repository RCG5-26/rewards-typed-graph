import type {
  AgentCommit,
  AgentCommitBinding,
  AgentCommitFactory,
  AgentCommitInput,
  CommitSuccess,
  ReadSet,
  SpecialistMutation,
} from "../../src/agents/contracts";
import { CommitFailure } from "../../src/agents/contracts";
import {
  stableFingerprint,
  validateCommitInput,
} from "../../src/agents/commit/validation";
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

      validateCommitInput(input, binding);

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
