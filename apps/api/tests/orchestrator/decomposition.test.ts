import { describe, expect, it } from "vitest";
import { OrchestrationError } from "../../src/orchestrator/contracts";
import { validateDecomposedQuery } from "../../src/orchestrator/decomposition";
import { Orchestrator } from "../../src/orchestrator/orchestrator";
import {
  FakeEarningAgent,
  FakeRedemptionAgent,
  FakeWalletAgent,
} from "../helpers/fake-agents";
import { RawDecomposer } from "../helpers/fake-decomposer";
import { InMemoryAgentCommitFactory } from "../helpers/in-memory-commit";
import { InMemoryOrchestratorGraphWrite } from "../helpers/in-memory-graph-write";
import { StubGraphSnapshotBuilder } from "../helpers/stub-snapshot-builder";

describe("decomposition validation", () => {
  it("rejects an unknown agentType in decomposer output", () => {
    expect(() =>
      validateDecomposedQuery({
        invocations: [{ agentType: "unknown_agent", operation: { kind: "assess_wallet", agentType: "wallet_agent", programIds: ["p1"] } }],
      }),
    ).toThrowError(
      expect.objectContaining({ kind: "DecompositionInvalid" }),
    );
  });

  it("rejects an unknown operation kind", () => {
    expect(() =>
      validateDecomposedQuery({
        invocations: [
          {
            agentType: "wallet_agent",
            operation: { kind: "unknown_op", agentType: "wallet_agent", programIds: ["p1"] },
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ kind: "DecompositionInvalid" }),
    );
  });

  it("rejects an invocation whose agentType does not match its operation", () => {
    expect(() =>
      validateDecomposedQuery({
        invocations: [
          {
            agentType: "wallet_agent",
            operation: {
              kind: "recommend_earning",
              agentType: "earning_agent",
              spendCategoryIds: ["c1"],
            },
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ kind: "DecompositionInvalid" }),
    );
  });

  it("rejects an operation kind not valid for the declared agent", () => {
    expect(() =>
      validateDecomposedQuery({
        invocations: [
          {
            agentType: "wallet_agent",
            operation: {
              kind: "traverse_redemption",
              agentType: "wallet_agent",
              goalType: "specific_redemption",
              targetRedemptionOptionId: null,
              sourceProgramIds: ["p1"],
            },
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ kind: "DecompositionInvalid" }),
    );
  });

  it("rejects an unexpected free-text key on an invocation or operation", () => {
    expect(() =>
      validateDecomposedQuery({
        invocations: [
          {
            agentType: "wallet_agent",
            operation: {
              kind: "assess_wallet",
              agentType: "wallet_agent",
              programIds: ["p1"],
              prompt: "do something",
            },
          },
        ],
      }),
    ).toThrowError(
      expect.objectContaining({ kind: "DecompositionInvalid" }),
    );
  });

  it("rejects an empty invocation sequence", () => {
    expect(() => validateDecomposedQuery({ invocations: [] })).toThrowError(
      expect.objectContaining({ kind: "DecompositionInvalid" }),
    );
  });

  it("rejects an unexpected free-text key on the root decomposed query object", () => {
    expect(() =>
      validateDecomposedQuery({
        invocations: [
          {
            agentType: "wallet_agent",
            operation: {
              kind: "assess_wallet",
              agentType: "wallet_agent",
              programIds: ["p1"],
            },
          },
        ],
        prompt: "root level prose",
      }),
    ).toThrowError(expect.objectContaining({ kind: "DecompositionInvalid" }));
  });

  it("creates no AgentRun and fails the Plan on decomposition validation failure", async () => {
    const graphWrite = new InMemoryOrchestratorGraphWrite();
    const commitFactory = new InMemoryAgentCommitFactory(graphWrite);
    const orchestrator = new Orchestrator({
      decomposer: new RawDecomposer({ invocations: [] }),
      graphWrite,
      snapshotBuilder: new StubGraphSnapshotBuilder(),
      agentRegistry: {
        wallet_agent: new FakeWalletAgent(),
        earning_agent: new FakeEarningAgent(),
        redemption_agent: new FakeRedemptionAgent(),
      },
      commitFactory,
    });

    await expect(
      orchestrator.run({ userId: "user-1", queryText: "bad query" }),
    ).rejects.toBeInstanceOf(OrchestrationError);

    expect(graphWrite.agentRuns.size).toBe(0);
    expect(commitFactory.recordedCommits).toHaveLength(0);
    const plan = [...graphWrite.plans.values()][0];
    expect(plan.status).toBe("failed");
  });
});
