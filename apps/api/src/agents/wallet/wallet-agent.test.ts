/**
 * Contract tests for WalletAgent (M2).
 */

import { describe, expect, it, vi } from "vitest";
import type { AgentCommitInput } from "../contracts";
import { CommitFailure } from "../contracts";
import { WalletAgent } from "./wallet-agent";
import type { AgentContext } from "../contracts";
import type { WalletAssessmentOperation } from "../../orchestrator/contracts";

const B001 = "00000000-0000-0000-0000-00000000b001";
const B002 = "00000000-0000-0000-0000-00000000b002";
const D001 = "00000000-0000-0000-0000-00000000d001";
const D002 = "00000000-0000-0000-0000-00000000d002";

function makeContext(
  programIds: string[],
  balances: Array<{ id: string; programId: string; balancePoints: number; version: number }>,
): AgentContext<"wallet_agent"> & { capturedCommits: AgentCommitInput[] } {
  const capturedCommits: AgentCommitInput[] = [];
  return {
    planId: "plan-1",
    userId: "user-1",
    agentRunId: "run-1",
    operation: {
      kind: "assess_wallet",
      agentType: "wallet_agent",
      programIds,
    } satisfies WalletAssessmentOperation,
    snapshot: {
      userBalances: balances,
      userGoals: [],
      userProgramStatuses: [],
    },
    commit: vi.fn().mockImplementation((input: AgentCommitInput) => {
      capturedCommits.push(input);
      return Promise.resolve({ mutationTxnId: "txn-1", idempotencyReplayed: false });
    }),
    capturedCommits,
  };
}

describe("WalletAgent", () => {
  it("emits one UpdateUserBalance commit per matching program", async () => {
    const agent = new WalletAgent();
    const ctx = makeContext([B001, B002], [
      { id: D001, programId: B001, balancePoints: 180_000, version: 1 },
      { id: D002, programId: B002, balancePoints: 30_000, version: 1 },
    ]);

    await agent.run(ctx);

    expect(ctx.capturedCommits).toHaveLength(2);
    expect(ctx.capturedCommits[0].mutation).toMatchObject({
      kind: "UpdateUserBalance",
      balanceNodeId: D001,
      balancePoints: 180_000,
    });
  });

  it("uses balance.id as the readSet key with correct version", async () => {
    const agent = new WalletAgent();
    const ctx = makeContext([B001], [
      { id: D001, programId: B001, balancePoints: 180_000, version: 3 },
    ]);

    await agent.run(ctx);

    expect(ctx.capturedCommits[0].readSet).toEqual({ [D001]: 3 });
  });

  it("idempotency key encodes planId and balance node id", async () => {
    const agent = new WalletAgent();
    const ctx = makeContext([B001], [
      { id: D001, programId: B001, balancePoints: 100, version: 0 },
    ]);

    await agent.run(ctx);

    expect(ctx.capturedCommits[0].idempotencyKey).toContain("wallet-assess:");
    expect(ctx.capturedCommits[0].idempotencyKey).toContain(D001);
  });

  it("emits no commits when no matching balances", async () => {
    const agent = new WalletAgent();
    const ctx = makeContext([B001], [
      { id: D002, programId: B002, balancePoints: 30_000, version: 1 },
    ]);

    await agent.run(ctx);

    expect(ctx.capturedCommits).toHaveLength(0);
  });

  it("filters to only the requested programIds", async () => {
    const agent = new WalletAgent();
    const ctx = makeContext([B001], [
      { id: D001, programId: B001, balancePoints: 180_000, version: 1 },
      { id: D002, programId: B002, balancePoints: 30_000, version: 1 },
    ]);

    await agent.run(ctx);

    expect(ctx.capturedCommits).toHaveLength(1);
    expect(ctx.capturedCommits[0].mutation).toMatchObject({ balanceNodeId: D001 });
  });

  it("throws ValidationError when operation has empty programIds", async () => {
    const agent = new WalletAgent();
    const ctx = makeContext([], []);

    await expect(agent.run(ctx)).rejects.toMatchObject({ kind: "ValidationError" });
  });

  it("throws ValidationError when a programId entry is an empty string", async () => {
    // Covers the per-item guard in validateOperation (not just the empty-array
    // case), so the item-level rejection branch cannot regress silently.
    const agent = new WalletAgent();
    const ctx = makeContext([""], []);

    await expect(agent.run(ctx)).rejects.toMatchObject({ kind: "ValidationError" });
  });

  it("produces stable ordering by programId (deterministic across calls)", async () => {
    const agent = new WalletAgent();
    const balances = [
      { id: D002, programId: B002, balancePoints: 30_000, version: 1 },
      { id: D001, programId: B001, balancePoints: 180_000, version: 1 },
    ];

    const ctxA = makeContext([B001, B002], balances);
    const ctxB = makeContext([B001, B002], balances);

    await agent.run(ctxA);
    await agent.run(ctxB);

    const idsA = ctxA.capturedCommits.map((c) => (c.mutation as { balanceNodeId: string }).balanceNodeId);
    const idsB = ctxB.capturedCommits.map((c) => (c.mutation as { balanceNodeId: string }).balanceNodeId);
    expect(idsA).toEqual(idsB);
  });
});
