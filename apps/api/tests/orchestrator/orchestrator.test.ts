import { describe, expect, it } from "vitest";
import type { AgentCommitFactory, AgentRegistry } from "../../src/agents/contracts";
import type { Decomposer } from "../../src/orchestrator/contracts";
import { Orchestrator } from "../../src/orchestrator/orchestrator";
import {
  FakeEarningAgent,
  FakeRedemptionAgent,
  FakeWalletAgent,
  FailingEarningAgent,
  SpecialistNamingPlanCommand,
} from "../helpers/fake-agents";
import {
  FakeDecomposer,
  PERSONA_QUERY,
  RawDecomposer,
  tokyoFixture,
} from "../helpers/fake-decomposer";
import { InMemoryAgentCommitFactory, ThrowingCommitFactory } from "../helpers/in-memory-commit";
import { InMemoryOrchestratorGraphWrite } from "../helpers/in-memory-graph-write";
import { StubGraphSnapshotBuilder } from "../helpers/stub-snapshot-builder";

function buildHarness(options?: {
  registry?: AgentRegistry;
  decomposer?: Decomposer;
  graphWrite?: InMemoryOrchestratorGraphWrite;
  snapshotBuilder?: StubGraphSnapshotBuilder;
  commitFactory?: AgentCommitFactory;
}) {
  const graphWrite = options?.graphWrite ?? new InMemoryOrchestratorGraphWrite();
  const memoryCommitFactory = new InMemoryAgentCommitFactory(graphWrite);
  const registry: AgentRegistry = options?.registry ?? {
    wallet_agent: new FakeWalletAgent(),
    earning_agent: new FakeEarningAgent(),
    redemption_agent: new FakeRedemptionAgent(),
  };
  const orchestrator = new Orchestrator({
    decomposer: options?.decomposer ?? new FakeDecomposer(tokyoFixture),
    graphWrite,
    snapshotBuilder: options?.snapshotBuilder ?? new StubGraphSnapshotBuilder(),
    agentRegistry: registry,
    commitFactory: options?.commitFactory ?? memoryCommitFactory,
  });
  return { orchestrator, graphWrite, commitFactory: memoryCommitFactory };
}

const walletOnlyFixture = {
  invocations: [
    {
      agentType: "wallet_agent" as const,
      operation: {
        kind: "assess_wallet" as const,
        agentType: "wallet_agent" as const,
        programIds: ["program-chase-ur"],
      },
    },
  ],
};

describe("orchestrator", () => {
  it("decomposes a persona query into ordered typed operations", async () => {
    const captured: unknown[] = [];
    const decomposer: Decomposer = {
      async decompose(queryText: string) {
        captured.push(queryText);
        return tokyoFixture;
      },
    };
    const { orchestrator } = buildHarness({ decomposer });
    await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });

    expect(captured).toEqual([PERSONA_QUERY]);
    expect(tokyoFixture.invocations.map((i) => i.agentType)).toEqual([
      "wallet_agent",
      "earning_agent",
      "redemption_agent",
    ]);
    for (const invocation of tokyoFixture.invocations) {
      expect(invocation.operation.agentType).toBe(invocation.agentType);
    }
  });

  it("passes each agent the typed operation matching its own agent type", async () => {
    const received: Array<{ registeredType: string; operationAgentType: string }> = [];
    const registry: AgentRegistry = {
      wallet_agent: {
        agentType: "wallet_agent",
        async run(ctx) {
          received.push({
            registeredType: "wallet_agent",
            operationAgentType: ctx.operation.agentType,
          });
          await new FakeWalletAgent().run(ctx);
        },
      },
      earning_agent: {
        agentType: "earning_agent",
        async run(ctx) {
          received.push({
            registeredType: "earning_agent",
            operationAgentType: ctx.operation.agentType,
          });
          await new FakeEarningAgent().run(ctx);
        },
      },
      redemption_agent: {
        agentType: "redemption_agent",
        async run(ctx) {
          received.push({
            registeredType: "redemption_agent",
            operationAgentType: ctx.operation.agentType,
          });
          await new FakeRedemptionAgent().run(ctx);
        },
      },
    };
    const { orchestrator } = buildHarness({ registry });
    await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });

    expect(received).toHaveLength(3);
    for (const entry of received) {
      expect(entry.registeredType).toBe(entry.operationAgentType);
    }
  });

  it("creates one Plan generating then current with one ordered AgentRun per invocation", async () => {
    const { orchestrator, graphWrite } = buildHarness();
    const result = await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });

    const plan = graphWrite.plans.get(result.planId);
    expect(plan?.status).toBe("current");
    expect(plan?.revisionNumber).toBe(1);
    expect(plan?.planType).toBe("agent_generated");
    expect(result.agentRunIds).toHaveLength(3);

    const runs = result.agentRunIds.map((id) => graphWrite.agentRuns.get(id)!);
    expect(runs.map((r) => r.agentType)).toEqual([
      "wallet_agent",
      "earning_agent",
      "redemption_agent",
    ]);
    expect(runs.every((r) => r.status === "completed")).toBe(true);
  });

  it("records last_read_versions from readSet on first successful commit", async () => {
    const { orchestrator, graphWrite } = buildHarness();
    const result = await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });
    const walletRun = graphWrite.agentRuns.get(result.agentRunIds[0])!;
    expect(walletRun.state?.last_read_versions).toEqual({ "balance-chase-ur": 2 });
  });

  it("merges last_read_versions across multiple commits in one run", async () => {
    const graphWrite = new InMemoryOrchestratorGraphWrite();
    const commitFactory = new InMemoryAgentCommitFactory(graphWrite);
    const registry: AgentRegistry = {
      wallet_agent: {
        agentType: "wallet_agent",
        async run(ctx) {
          await ctx.commit({
            mutation: {
              kind: "UpdateUserBalance",
              balanceNodeId: "balance-chase-ur",
              balancePoints: 85000,
            },
            readSet: { "balance-chase-ur": 2 },
            idempotencyKey: `${ctx.agentRunId}:0`,
          });
          await ctx.commit({
            mutation: {
              kind: "UpdateUserBalance",
              balanceNodeId: "balance-amex-mr",
              balancePoints: 40000,
            },
            readSet: { "balance-chase-ur": 3, "balance-amex-mr": 1 },
            idempotencyKey: `${ctx.agentRunId}:1`,
          });
        },
      },
      earning_agent: new FakeEarningAgent(),
      redemption_agent: new FakeRedemptionAgent(),
    };
    const orchestrator = new Orchestrator({
      decomposer: new FakeDecomposer(tokyoFixture),
      graphWrite,
      snapshotBuilder: new StubGraphSnapshotBuilder(),
      agentRegistry: registry,
      commitFactory,
    });
    const result = await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });
    const walletRun = graphWrite.agentRuns.get(result.agentRunIds[0])!;
    expect(walletRun.state?.last_read_versions).toEqual({
      "balance-chase-ur": 3,
      "balance-amex-mr": 1,
    });
  });

  it("persists neither mutation nor checkpoint when a commit fails", async () => {
    const graphWrite = new InMemoryOrchestratorGraphWrite();
    const commitFactory = new InMemoryAgentCommitFactory(graphWrite);
    const registry: AgentRegistry = {
      wallet_agent: new FakeWalletAgent(),
      earning_agent: {
        agentType: "earning_agent",
        async run(ctx) {
          await ctx.commit({
            mutation: {
              kind: "CreatePlanStep",
              planId: ctx.planId,
              stepOrder: 1,
              stepType: "spend_analysis",
              payload: { spendCategoryId: "", recommendedCardId: "card-csp" },
            },
            readSet: { "balance-chase-ur": 2 },
            idempotencyKey: `${ctx.agentRunId}:0`,
          });
        },
      },
      redemption_agent: new FakeRedemptionAgent(),
    };
    const orchestrator = new Orchestrator({
      decomposer: new FakeDecomposer(tokyoFixture),
      graphWrite,
      snapshotBuilder: new StubGraphSnapshotBuilder(),
      agentRegistry: registry,
      commitFactory,
    });
    await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });
    const earningRunId = [...graphWrite.agentRuns.values()].find(
      (r) => r.agentType === "earning_agent",
    )!.id;
    const earningRun = graphWrite.agentRuns.get(earningRunId)!;
    expect(commitFactory.recordedCommits).toHaveLength(1);
    expect(earningRun.state).toBeNull();
  });

  it("marks the AgentRun failed when a commit fails", async () => {
    const graphWrite = new InMemoryOrchestratorGraphWrite();
    const commitFactory = new InMemoryAgentCommitFactory(graphWrite);
    const registry: AgentRegistry = {
      wallet_agent: new FakeWalletAgent(),
      earning_agent: {
        agentType: "earning_agent",
        async run(ctx) {
          await ctx.commit({
            mutation: {
              kind: "CreatePlanStep",
              planId: ctx.planId,
              stepOrder: 1,
              stepType: "spend_analysis",
              payload: { spendCategoryId: "", recommendedCardId: "card-csp" },
            },
            readSet: { "balance-chase-ur": 2 },
            idempotencyKey: `${ctx.agentRunId}:0`,
          });
        },
      },
      redemption_agent: new FakeRedemptionAgent(),
    };
    const orchestrator = new Orchestrator({
      decomposer: new FakeDecomposer(tokyoFixture),
      graphWrite,
      snapshotBuilder: new StubGraphSnapshotBuilder(),
      agentRegistry: registry,
      commitFactory,
    });
    await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });
    const earningRun = [...graphWrite.agentRuns.values()].find(
      (r) => r.agentType === "earning_agent",
    )!;
    expect(earningRun.status).toBe("failed");
    expect(earningRun.error).toBeTruthy();
  });

  it("marks the Plan failed when a required commit fails", async () => {
    const graphWrite = new InMemoryOrchestratorGraphWrite();
    const commitFactory = new InMemoryAgentCommitFactory(graphWrite);
    const registry: AgentRegistry = {
      wallet_agent: new FakeWalletAgent(),
      earning_agent: {
        agentType: "earning_agent",
        async run(ctx) {
          await ctx.commit({
            mutation: {
              kind: "CreatePlanStep",
              planId: ctx.planId,
              stepOrder: 1,
              stepType: "spend_analysis",
              payload: { spendCategoryId: "", recommendedCardId: "card-csp" },
            },
            readSet: { "balance-chase-ur": 2 },
            idempotencyKey: `${ctx.agentRunId}:0`,
          });
        },
      },
      redemption_agent: new FakeRedemptionAgent(),
    };
    const orchestrator = new Orchestrator({
      decomposer: new FakeDecomposer(tokyoFixture),
      graphWrite,
      snapshotBuilder: new StubGraphSnapshotBuilder(),
      agentRegistry: registry,
      commitFactory,
    });
    const result = await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });
    expect(graphWrite.plans.get(result.planId)?.status).toBe("failed");
  });

  it("does not invoke later agents after a failed commit", async () => {
    const graphWrite = new InMemoryOrchestratorGraphWrite();
    const commitFactory = new InMemoryAgentCommitFactory(graphWrite);
    const registry: AgentRegistry = {
      wallet_agent: new FakeWalletAgent(),
      earning_agent: {
        agentType: "earning_agent",
        async run(ctx) {
          await ctx.commit({
            mutation: {
              kind: "CreatePlanStep",
              planId: ctx.planId,
              stepOrder: 1,
              stepType: "spend_analysis",
              payload: { spendCategoryId: "", recommendedCardId: "card-csp" },
            },
            readSet: { "balance-chase-ur": 2 },
            idempotencyKey: `${ctx.agentRunId}:0`,
          });
        },
      },
      redemption_agent: new FakeRedemptionAgent(),
    };
    const orchestrator = new Orchestrator({
      decomposer: new FakeDecomposer(tokyoFixture),
      graphWrite,
      snapshotBuilder: new StubGraphSnapshotBuilder(),
      agentRegistry: registry,
      commitFactory,
    });
    await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });
    const redemptionRun = [...graphWrite.agentRuns.values()].find(
      (r) => r.agentType === "redemption_agent",
    );
    expect(redemptionRun).toBeUndefined();
  });

  it("treats a thrown agent error like a failed commit", async () => {
    const { orchestrator, graphWrite } = buildHarness({
      registry: {
        wallet_agent: new FakeWalletAgent(),
        earning_agent: new FailingEarningAgent(),
        redemption_agent: new FakeRedemptionAgent(),
      },
    });
    const result = await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });

    const earningRun = [...graphWrite.agentRuns.values()].find(
      (r) => r.agentType === "earning_agent",
    )!;
    expect(earningRun.status).toBe("failed");
    expect(earningRun.error).toBe("earning_agent_error: external data unavailable");
    expect(graphWrite.plans.get(result.planId)?.status).toBe("failed");
    expect([...graphWrite.agentRuns.values()].some((r) => r.agentType === "redemption_agent")).toBe(
      false,
    );
  });

  it("is the only component that creates or transitions Plans", async () => {
    const graphWrite = new InMemoryOrchestratorGraphWrite();
    const commitFactory = new InMemoryAgentCommitFactory(graphWrite);
    const { orchestrator } = buildHarness({
      graphWrite,
      commitFactory,
      decomposer: new FakeDecomposer(walletOnlyFixture),
      registry: {
        wallet_agent: new SpecialistNamingPlanCommand(),
        earning_agent: new FakeEarningAgent(),
        redemption_agent: new FakeRedemptionAgent(),
      },
    });

    const result = await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });

    expect(graphWrite.commandCounts.createPlan).toBe(1);
    expect(graphWrite.commandCounts.transitionPlanStatus).toBeGreaterThanOrEqual(1);
    expect(result.status).toBe("failed");
    expect(graphWrite.plans.get(result.planId)?.status).toBe("failed");
    expect(commitFactory.recordedCommits).toHaveLength(0);
  });

  it("completes the persona flow end to end on in-memory doubles", async () => {
    const { orchestrator, graphWrite, commitFactory } = buildHarness();
    const result = await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });

    const plan = graphWrite.plans.get(result.planId)!;
    expect(plan.status).toBe("current");
    expect(plan.queryText).toBe(PERSONA_QUERY);
    expect(plan.revisionNumber).toBe(1);
    expect(plan.planType).toBe("agent_generated");
    expect(result.status).toBe("current");

    const runs = result.agentRunIds.map((id) => graphWrite.agentRuns.get(id)!);
    expect(runs.map((r) => r.agentType)).toEqual([
      "wallet_agent",
      "earning_agent",
      "redemption_agent",
    ]);
    expect(runs.every((r) => r.status === "completed")).toBe(true);
    expect(runs[0].state?.last_read_versions).toEqual({ "balance-chase-ur": 2 });
    // earning_agent owns no mutations (MUTATION_OWNERSHIP earning_agent: []) — run[1].state is null
    expect(runs[1].state).toBeNull();
    expect(runs[2].state?.last_read_versions).toEqual({
      "balance-chase-ur": 2,
      "route-chase-hyatt": 5,
    });

    // wallet (1) + redemption (1) = 2 commits; earning_agent submits no mutations
    expect(commitFactory.recordedCommits).toHaveLength(2);
    expect(new Set(commitFactory.recordedCommits.map((c) => c.idempotencyKey)).size).toBe(2);

    const walletMutation = commitFactory.recordedCommits[0].mutation;
    expect(walletMutation.kind).toBe("UpdateUserBalance");
    if (walletMutation.kind === "UpdateUserBalance") {
      expect(walletMutation.balanceNodeId).toBe("balance-chase-ur");
    }

    const redemptionMutation = commitFactory.recordedCommits[1].mutation;
    expect(redemptionMutation.kind).toBe("CreatePlanStep");
    if (
      redemptionMutation.kind === "CreatePlanStep" &&
      redemptionMutation.stepType === "redemption_recommendation"
    ) {
      expect(redemptionMutation.payload.redemptionOptionId).toBe("option-hyatt-tokyo");
      expect(redemptionMutation.payload.sourceProgramId).toBe("program-chase-ur");
    }
  });

  it("derives each agent's committed mutation from its typed operation", async () => {
    const { orchestrator, commitFactory } = buildHarness();
    await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });

    // earning_agent owns no mutations, so only wallet (index 0) and redemption (index 1) commit
    expect(commitFactory.recordedCommits).toHaveLength(2);

    const walletMutation = commitFactory.recordedCommits[0].mutation;
    if (walletMutation.kind === "UpdateUserBalance") {
      expect(walletMutation.balanceNodeId).toBe("balance-chase-ur");
    }

    const redemptionMutation = commitFactory.recordedCommits[1].mutation;
    if (
      redemptionMutation.kind === "CreatePlanStep" &&
      redemptionMutation.stepType === "redemption_recommendation"
    ) {
      expect(redemptionMutation.payload.redemptionOptionId).toBe("option-hyatt-tokyo");
      expect(redemptionMutation.payload.sourceProgramId).toBe("program-chase-ur");
    }
  });

  it("produces a different mutation when the operation changes", async () => {
    const amexFixture = {
      invocations: [
        {
          agentType: "wallet_agent" as const,
          operation: {
            kind: "assess_wallet" as const,
            agentType: "wallet_agent" as const,
            programIds: ["program-amex-mr"],
          },
        },
      ],
    };
    const { orchestrator, commitFactory } = buildHarness({
      decomposer: new FakeDecomposer(amexFixture),
    });
    await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });

    const mutation = commitFactory.recordedCommits[0].mutation;
    if (mutation.kind === "UpdateUserBalance") {
      expect(mutation.balanceNodeId).toBe("balance-amex-mr");
    }
    expect(commitFactory.recordedCommits[0].readSet).toEqual({ "balance-amex-mr": 1 });
  });

  describe("lifecycle failure handling", () => {
    it("marks the Plan failed when createAgentRun throws", async () => {
      const graphWrite = new InMemoryOrchestratorGraphWrite();
      graphWrite.setThrowOnCreateAgentRun(new Error("createAgentRun failed"));
      const { orchestrator } = buildHarness({
        graphWrite,
        decomposer: new FakeDecomposer(walletOnlyFixture),
      });

      const result = await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });

      expect(result.status).toBe("failed");
      expect(graphWrite.plans.get(result.planId)?.status).toBe("failed");
      expect(graphWrite.agentRuns.size).toBe(0);
      expect(result.agentRunIds).toHaveLength(0);
    });

    it("finalizes the AgentRun failed when snapshotBuilder.build throws", async () => {
      const graphWrite = new InMemoryOrchestratorGraphWrite();
      const snapshotBuilder = new StubGraphSnapshotBuilder();
      snapshotBuilder.setThrowOnBuild(new Error("snapshot build failed"));
      const { orchestrator } = buildHarness({
        graphWrite,
        snapshotBuilder,
        decomposer: new FakeDecomposer(walletOnlyFixture),
      });

      const result = await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });
      const run = graphWrite.agentRuns.get(result.agentRunIds[0])!;

      expect(result.status).toBe("failed");
      expect(graphWrite.plans.get(result.planId)?.status).toBe("failed");
      expect(run.status).toBe("failed");
      expect(run.error).toBe("orchestration infrastructure failed: snapshot build failed");
    });

    it("finalizes the AgentRun failed when commitFactory.create throws", async () => {
      const graphWrite = new InMemoryOrchestratorGraphWrite();
      const { orchestrator } = buildHarness({
        graphWrite,
        decomposer: new FakeDecomposer(walletOnlyFixture),
        commitFactory: new ThrowingCommitFactory(new Error("commit factory failed")),
      });

      const result = await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });
      const run = graphWrite.agentRuns.get(result.agentRunIds[0])!;

      expect(result.status).toBe("failed");
      expect(run.status).toBe("failed");
      expect(run.error).toBe("orchestration infrastructure failed: commit factory failed");
    });

    it("treats finalizeAgentRun completed failure as lifecycle persistence failure", async () => {
      const graphWrite = new InMemoryOrchestratorGraphWrite();
      graphWrite.setThrowOnFinalizeCompleted(new Error("finalize completed failed"));
      const { orchestrator } = buildHarness({
        graphWrite,
        decomposer: new FakeDecomposer(walletOnlyFixture),
      });

      const result = await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });
      const run = graphWrite.agentRuns.get(result.agentRunIds[0])!;

      expect(result.status).toBe("failed");
      expect(run.status).toBe("failed");
      expect(run.error).toBe("lifecycle persistence failed: finalize completed failed");
      expect(run.error).not.toContain("assess_wallet");
    });

    it("preserves the agent error when finalizeAgentRun failed throws during cleanup", async () => {
      const graphWrite = new InMemoryOrchestratorGraphWrite();
      graphWrite.setThrowOnFinalizeFailed(new Error("finalize failed cleanup error"));
      const { orchestrator } = buildHarness({
        graphWrite,
        decomposer: new FakeDecomposer(tokyoFixture),
        registry: {
          wallet_agent: new FakeWalletAgent(),
          earning_agent: new FailingEarningAgent(),
          redemption_agent: new FakeRedemptionAgent(),
        },
      });

      const result = await orchestrator.run({ userId: "user-1", queryText: PERSONA_QUERY });
      const earningRun = [...graphWrite.agentRuns.values()].find(
        (run) => run.agentType === "earning_agent",
      )!;

      expect(result.status).toBe("failed");
      expect(graphWrite.plans.get(result.planId)?.status).toBe("failed");
      expect(earningRun.status).toBe("running");
      expect(earningRun.error).toBeNull();
    });

    it("preserves the original OrchestrationError when transitionPlanStatus fails during decomposition cleanup", async () => {
      const graphWrite = new InMemoryOrchestratorGraphWrite();
      graphWrite.setThrowOnTransitionFailed(new Error("transition failed during cleanup"));
      const orchestrator = new Orchestrator({
        decomposer: new RawDecomposer({ invocations: [] }),
        graphWrite,
        snapshotBuilder: new StubGraphSnapshotBuilder(),
        agentRegistry: {
          wallet_agent: new FakeWalletAgent(),
          earning_agent: new FakeEarningAgent(),
          redemption_agent: new FakeRedemptionAgent(),
        },
        commitFactory: new InMemoryAgentCommitFactory(graphWrite),
      });

      await expect(
        orchestrator.run({ userId: "user-1", queryText: "bad query" }),
      ).rejects.toMatchObject({
        kind: "DecompositionInvalid",
        detail: {
          cleanupErrors: ["transitionPlanStatus(failed): transition failed during cleanup"],
        },
      });
    });
  });
});
