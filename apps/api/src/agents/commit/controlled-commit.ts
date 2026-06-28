/**
 * M3 — Production AgentCommitFactory that routes validated specialist mutations
 * through the Python graph-write boundary via PythonWriteBridge.
 *
 * Invariants:
 *  - Zero direct TypeScript SQL writes. The only write path is bridge subprocess.
 *  - Shared validation module (validation.ts) runs before any bridge call, same
 *    code path as the in-memory test double — Contract 4 cannot drift.
 *  - Idempotency is preserved: bridge errors with code "idempotency_conflict"
 *    are surfaced as CommitSuccess(idempotencyReplayed: true).
 */

import type {
  AgentCommit,
  AgentCommitBinding,
  AgentCommitFactory,
  AgentCommitInput,
  CommitSuccess,
} from "../contracts";
import { CommitFailure } from "../contracts";
import { validateCommitInput } from "./validation";
import type { PythonWriteBridge } from "./python-write-bridge";

export class ControlledAgentCommitFactory implements AgentCommitFactory {
  constructor(private readonly bridge: PythonWriteBridge) {}

  create(binding: AgentCommitBinding): AgentCommit {
    const { userId, planId, agentRunId, agentType } = binding;

    return async (input: AgentCommitInput): Promise<CommitSuccess> => {
      validateCommitInput(input, binding);

      try {
        const result = await this.bridge.commitMutation({
          mutation: input.mutation,
          userId,
          planId,
          agentRunId,
          agentType,
          idempotencyKey: input.idempotencyKey,
          readSet: input.readSet,
        });

        return {
          mutationTxnId: result.mutationTxnId,
          idempotencyReplayed: result.idempotencyReplayed ?? false,
        };
      } catch (err) {
        if (err instanceof CommitFailure && err.kind === "IdempotencyConflict") {
          return {
            mutationTxnId: `idempotent-replay:${input.idempotencyKey}`,
            idempotencyReplayed: true,
          };
        }
        throw err;
      }
    };
  }
}
