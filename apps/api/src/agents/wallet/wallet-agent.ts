/**
 * M2 — Deterministic Wallet specialist adapter.
 *
 * Receives a constrained user-scoped snapshot and emits one UpdateUserBalance
 * mutation per program in the operation's programIds list. No LLM, no DB access,
 * no network. Bounded output — at most one commit per programId.
 *
 * Ownership: wallet_agent → UpdateUserBalance only (enforced by validation.ts).
 */

import type { Agent, AgentContext, GraphSnapshot, UserBalanceRow } from "../contracts";
import { CommitFailure } from "../contracts";
import type { WalletAssessmentOperation } from "../../orchestrator/contracts";

export class WalletAgent implements Agent<"wallet_agent"> {
  readonly agentType = "wallet_agent" as const;

  async run(context: AgentContext<"wallet_agent">): Promise<void> {
    const { operation, snapshot, commit } = context;

    validateOperation(operation);
    const balances = filterBalances(snapshot, operation.programIds);

    if (balances.length === 0) {
      return;
    }

    let stepOrder = 1;
    for (const balance of balances) {
      await commit({
        mutation: {
          kind: "UpdateUserBalance",
          balanceNodeId: balance.id,
          balancePoints: balance.balancePoints,
        },
        readSet: { [balance.id]: balance.version },
        idempotencyKey: `wallet-assess:${context.planId}:${balance.id}`,
      });
      stepOrder += 1;
    }

    void stepOrder;
  }
}

function validateOperation(op: WalletAssessmentOperation): void {
  if (!Array.isArray(op.programIds) || op.programIds.length === 0) {
    throw new CommitFailure(
      "ValidationError",
      "WalletAssessmentOperation requires at least one programId",
    );
  }
  for (const id of op.programIds) {
    if (typeof id !== "string" || !id) {
      throw new CommitFailure("ValidationError", "programIds must be non-empty strings");
    }
  }
}

function filterBalances(
  snapshot: GraphSnapshot,
  programIds: readonly string[],
): UserBalanceRow[] {
  const wanted = new Set(programIds);
  return snapshot.userBalances
    .filter((b) => wanted.has(b.programId))
    .sort((a, b) => a.programId.localeCompare(b.programId));
}
