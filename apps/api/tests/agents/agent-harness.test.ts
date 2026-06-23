import { describe, expect, it } from "vitest";
import type {
  Agent,
  AgentCommitInput,
  AgentContext,
  SpecialistMutation,
} from "../../src/agents/contracts";
import type {
  AgentInvocation,
  EarningRecommendationOperation,
  RedemptionTraversalOperation,
} from "../../src/orchestrator/contracts";

describe("agent harness type-level guarantees", () => {
  it("rejects a free-text field on AgentInvocation at compile time", () => {
    const invocation: AgentInvocation = {
      agentType: "wallet_agent",
      operation: {
        kind: "assess_wallet",
        agentType: "wallet_agent",
        programIds: ["p1"],
      },
      // @ts-expect-error AgentInvocation must not carry free-text coordination fields
      prompt: "x",
    };
    expect(invocation.agentType).toBe("wallet_agent");
  });

  it("exposes only the declared capabilities on AgentContext", () => {
    const ctx = {} as AgentContext<"wallet_agent">;
    // @ts-expect-error AgentContext must not expose a database client
    const _db = ctx.db;
    // @ts-expect-error AgentContext must not expose an HTTP client
    const _http = ctx.http;
    // @ts-expect-error AgentContext must not expose a message bus
    const _bus = ctx.bus;
    // @ts-expect-error AgentContext must not expose peer agents
    const _otherAgents = ctx.otherAgents;
    // @ts-expect-error AgentContext must not expose the commit factory
    const _commitFactory = ctx.commitFactory;
    void _db;
    void _http;
    void _bus;
    void _otherAgents;
    void _commitFactory;
    expect(true).toBe(true);
  });

  it("binds each agent type to exactly its operation type", () => {
    const badWalletAgent: Agent<"wallet_agent"> = {
      agentType: "wallet_agent",
      run(ctx) {
        // @ts-expect-error wallet_agent context must not receive earning operations
        const _earning: EarningRecommendationOperation = ctx.operation;
        // @ts-expect-error wallet_agent context must not receive redemption operations
        const _redemption: RedemptionTraversalOperation = ctx.operation;
        void _earning;
        void _redemption;
        return Promise.resolve();
      },
    };
    expect(badWalletAgent.agentType).toBe("wallet_agent");
  });

  it("excludes orchestrator commands from the agent-facing commit at compile time", () => {
    const commit = async (_input: AgentCommitInput) => ({
      mutationTxnId: "txn-1",
      idempotencyReplayed: false,
    });
    const input: AgentCommitInput = {
      // @ts-expect-error CreatePlan is an orchestrator command, not a SpecialistMutation
      mutation: { kind: "CreatePlan", userId: "u1", planLineageId: "l1", queryText: "q" },
      readSet: {},
      idempotencyKey: "key-1",
    };
    void commit(input);

    const mutation: SpecialistMutation = {
      kind: "UpdateUserBalance",
      balanceNodeId: "b1",
      balancePoints: 1,
    };
    expect(mutation.kind).toBe("UpdateUserBalance");
  });
});
