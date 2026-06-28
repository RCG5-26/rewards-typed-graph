import { describe, expect, it } from "vitest";
import { CommitFailure } from "../../src/agents/contracts";
import {
  FakeWalletAgent,
  SpecialistNamingPlanCommand,
  WalletAgentSubmittingDependency,
} from "../helpers/fake-agents";
import { InMemoryAgentCommitFactory } from "../helpers/in-memory-commit";
import { InMemoryOrchestratorGraphWrite } from "../helpers/in-memory-graph-write";

function createCommit(
  agentType: "wallet_agent" | "earning_agent" | "redemption_agent" = "wallet_agent",
) {
  const graphWrite = new InMemoryOrchestratorGraphWrite();
  const factory = new InMemoryAgentCommitFactory(graphWrite);
  const agentRun = {
    id: "run-1",
    agentType,
    planId: "plan-1",
    userId: "user-1",
    status: "running" as const,
    state: null,
    error: null,
  };
  graphWrite.agentRuns.set(agentRun.id, agentRun);
  const commit = factory.create({
    userId: "user-1",
    planId: "plan-1",
    agentRunId: agentRun.id,
    agentType,
  });
  return { commit, factory, graphWrite, agentRunId: agentRun.id };
}

describe("commit ownership", () => {
  it("rejects an unknown mutation variant before any state change", async () => {
    const { commit, factory } = createCommit();
    await expect(
      commit({
        mutation: { kind: "TransferPoints" } as never,
        readSet: {},
        idempotencyKey: "key-1",
      }),
    ).rejects.toMatchObject({ kind: "ValidationError" });
    expect(factory.recordedCommits).toHaveLength(0);
  });

  it("rejects a wallet agent submitting a redemption-owned mutation", async () => {
    const graphWrite = new InMemoryOrchestratorGraphWrite();
    const factory = new InMemoryAgentCommitFactory(graphWrite);
    const agentRunId = "run-wallet";
    graphWrite.agentRuns.set(agentRunId, {
      id: agentRunId,
      agentType: "wallet_agent",
      planId: "plan-1",
      userId: "user-1",
      status: "running",
      state: null,
      error: null,
    });
    const commit = factory.create({
      userId: "user-1",
      planId: "plan-1",
      agentRunId,
      agentType: "wallet_agent",
    });
    const agent = new WalletAgentSubmittingDependency();
    await expect(
      agent.run({
        planId: "plan-1",
        userId: "user-1",
        agentRunId,
        operation: {
          kind: "assess_wallet",
          agentType: "wallet_agent",
          programIds: ["program-chase-ur"],
        },
        snapshot: { userBalances: [], userGoals: [], userProgramStatuses: [] },
        commit,
      }),
    ).rejects.toMatchObject({ kind: "OwnershipError" });
    expect(factory.recordedCommits).toHaveLength(0);
  });

  it("rejects a specialist naming a Plan command", async () => {
    const graphWrite = new InMemoryOrchestratorGraphWrite();
    const factory = new InMemoryAgentCommitFactory(graphWrite);
    const agentRunId = "run-wallet";
    graphWrite.agentRuns.set(agentRunId, {
      id: agentRunId,
      agentType: "wallet_agent",
      planId: "plan-1",
      userId: "user-1",
      status: "running",
      state: null,
      error: null,
    });
    const commit = factory.create({
      userId: "user-1",
      planId: "plan-1",
      agentRunId,
      agentType: "wallet_agent",
    });
    const agent = new SpecialistNamingPlanCommand();
    await expect(
      agent.run({
        planId: "plan-1",
        userId: "user-1",
        agentRunId,
        operation: {
          kind: "assess_wallet",
          agentType: "wallet_agent",
          programIds: ["program-chase-ur"],
        },
        snapshot: { userBalances: [], userGoals: [], userProgramStatuses: [] },
        commit,
      }),
    ).rejects.toMatchObject({ kind: "ValidationError" });
    expect(factory.recordedCommits).toHaveLength(0);
  });

  it("replays the original result for the same key and equivalent request", async () => {
    const { commit, factory } = createCommit();
    const input = {
      mutation: {
        kind: "UpdateUserBalance" as const,
        balanceNodeId: "balance-chase-ur",
        balancePoints: 85000,
      },
      readSet: { "balance-chase-ur": 2 },
      idempotencyKey: "key-replay",
    };
    const first = await commit(input);
    const second = await commit(input);
    expect(second.idempotencyReplayed).toBe(true);
    expect(second.mutationTxnId).toBe(first.mutationTxnId);
    expect(factory.recordedCommits).toHaveLength(1);
  });

  it("rejects the same key with a different request as an idempotency conflict", async () => {
    const { commit, factory } = createCommit();
    await commit({
      mutation: {
        kind: "UpdateUserBalance",
        balanceNodeId: "balance-chase-ur",
        balancePoints: 85000,
      },
      readSet: { "balance-chase-ur": 2 },
      idempotencyKey: "key-conflict",
    });
    await expect(
      commit({
        mutation: {
          kind: "UpdateUserBalance",
          balanceNodeId: "balance-chase-ur",
          balancePoints: 90000,
        },
        readSet: { "balance-chase-ur": 2 },
        idempotencyKey: "key-conflict",
      }),
    ).rejects.toMatchObject({ kind: "IdempotencyConflict" });
    expect(factory.recordedCommits).toHaveLength(1);
  });

  it("rejects invalid identifiers, read-set versions, and empty idempotency keys", async () => {
    const { commit, factory } = createCommit();

    await expect(
      commit({
        mutation: { kind: "UpdateUserBalance", balanceNodeId: "", balancePoints: 1 },
        readSet: {},
        idempotencyKey: "key-1",
      }),
    ).rejects.toMatchObject({ kind: "ValidationError" });

    await expect(
      commit({
        mutation: {
          kind: "UpdateUserBalance",
          balanceNodeId: "balance-chase-ur",
          balancePoints: 1,
        },
        readSet: { "balance-chase-ur": -1 },
        idempotencyKey: "key-2",
      }),
    ).rejects.toMatchObject({ kind: "ValidationError" });

    await expect(
      commit({
        mutation: {
          kind: "UpdateUserBalance",
          balanceNodeId: "balance-chase-ur",
          balancePoints: 1,
        },
        readSet: {},
        idempotencyKey: "",
      }),
    ).rejects.toMatchObject({ kind: "ValidationError" });

    expect(factory.recordedCommits).toHaveLength(0);
  });

  it("replays a CreatePlanStep with the same nested payload and idempotency key", async () => {
    const { commit, factory } = createCommit("redemption_agent");
    const mutation = {
      kind: "CreatePlanStep" as const,
      planId: "plan-1",
      stepOrder: 1,
      stepType: "spend_analysis" as const,
      payload: {
        spendCategoryId: "category-travel",
        recommendedCardId: "card-csp",
      },
    };
    const first = await commit({ mutation, readSet: {}, idempotencyKey: "key-nested-replay" });
    const second = await commit({ mutation, readSet: {}, idempotencyKey: "key-nested-replay" });
    expect(second.idempotencyReplayed).toBe(true);
    expect(second.mutationTxnId).toBe(first.mutationTxnId);
    expect(factory.recordedCommits).toHaveLength(1);
  });

  it("rejects the same key when the CreatePlanStep nested payload differs", async () => {
    const { commit, factory } = createCommit("redemption_agent");
    await commit({
      mutation: {
        kind: "CreatePlanStep" as const,
        planId: "plan-1",
        stepOrder: 1,
        stepType: "spend_analysis" as const,
        payload: { spendCategoryId: "category-travel", recommendedCardId: "card-csp" },
      },
      readSet: {},
      idempotencyKey: "key-nested-conflict",
    });
    await expect(
      commit({
        mutation: {
          kind: "CreatePlanStep" as const,
          planId: "plan-1",
          stepOrder: 1,
          stepType: "spend_analysis" as const,
          payload: { spendCategoryId: "category-dining", recommendedCardId: "card-csp" },
        },
        readSet: {},
        idempotencyKey: "key-nested-conflict",
      }),
    ).rejects.toMatchObject({ kind: "IdempotencyConflict" });
    expect(factory.recordedCommits).toHaveLength(1);
  });

  it("rejects the same key when the RecordStateDependency nested snapshotValue differs", async () => {
    const { commit, factory } = createCommit("redemption_agent");
    const base: Parameters<typeof commit>[0]["mutation"] = {
      kind: "RecordStateDependency",
      planStepId: "step-1",
      targetNodeId: "balance-chase-ur",
      observedVersion: 2,
      target: {
        targetNodeType: "UserBalance",
        targetTable: "user_balances",
        dependedProperty: "balance_points",
        snapshotValue: { balancePoints: 85000 },
      },
    };
    await commit({ mutation: base, readSet: {}, idempotencyKey: "key-dep-conflict" });
    await expect(
      commit({
        mutation: {
          ...base,
          target: {
            targetNodeType: "UserBalance",
            targetTable: "user_balances",
            dependedProperty: "balance_points",
            snapshotValue: { balancePoints: 99000 },
          },
        },
        readSet: {},
        idempotencyKey: "key-dep-conflict",
      }),
    ).rejects.toMatchObject({ kind: "IdempotencyConflict" });
    expect(factory.recordedCommits).toHaveLength(1);
  });

  it("rolls back the mutation when the atomic checkpoint merge fails", async () => {
    const graphWrite = new InMemoryOrchestratorGraphWrite();
    const factory = new InMemoryAgentCommitFactory(graphWrite);
    const agentRunId = "run-wallet";
    graphWrite.agentRuns.set(agentRunId, {
      id: agentRunId,
      agentType: "wallet_agent",
      planId: "plan-1",
      userId: "user-1",
      status: "running",
      state: null,
      error: null,
    });
    factory.setFailCheckpointOnce(true);
    const commit = factory.create({
      userId: "user-1",
      planId: "plan-1",
      agentRunId,
      agentType: "wallet_agent",
    });
    const agent = new FakeWalletAgent();
    await expect(
      agent.run({
        planId: "plan-1",
        userId: "user-1",
        agentRunId,
        operation: {
          kind: "assess_wallet",
          agentType: "wallet_agent",
          programIds: ["program-chase-ur"],
        },
        snapshot: {
          userBalances: [
            {
              id: "balance-chase-ur",
              programId: "program-chase-ur",
              balancePoints: 85000,
              version: 2,
            },
          ],
          userGoals: [],
          userProgramStatuses: [],
        },
        commit,
      }),
    ).rejects.toMatchObject({ kind: "UnexpectedCommitError" });
    expect(factory.recordedCommits).toHaveLength(0);
    expect(graphWrite.agentRuns.get(agentRunId)?.state).toBeNull();
  });

  it("rolls back only the second commit when failCheckpointOnce is triggered on the second record", async () => {
    const graphWrite = new InMemoryOrchestratorGraphWrite();
    const factory = new InMemoryAgentCommitFactory(graphWrite);
    const agentRunId = "run-wallet";
    graphWrite.agentRuns.set(agentRunId, {
      id: agentRunId,
      agentType: "wallet_agent",
      planId: "plan-1",
      userId: "user-1",
      status: "running",
      state: null,
      error: null,
    });
    factory.setFailCheckpointOnNthRecord(2);
    const commit = factory.create({
      userId: "user-1",
      planId: "plan-1",
      agentRunId,
      agentType: "wallet_agent",
    });

    await commit({
      mutation: {
        kind: "UpdateUserBalance",
        balanceNodeId: "balance-chase-ur",
        balancePoints: 85000,
      },
      readSet: { "balance-chase-ur": 2 },
      idempotencyKey: "key-1",
    });

    await expect(
      commit({
        mutation: {
          kind: "UpdateUserBalance",
          balanceNodeId: "balance-amex-mr",
          balancePoints: 40000,
        },
        readSet: { "balance-amex-mr": 1 },
        idempotencyKey: "key-2",
      }),
    ).rejects.toMatchObject({ kind: "UnexpectedCommitError" });

    expect(factory.recordedCommits).toHaveLength(1);
    expect(factory.recordedCommits[0].mutation).toMatchObject({
      kind: "UpdateUserBalance",
      balanceNodeId: "balance-chase-ur",
    });
    expect(graphWrite.agentRuns.get(agentRunId)?.state).toEqual({
      last_read_versions: { "balance-chase-ur": 2 },
    });
  });
});
