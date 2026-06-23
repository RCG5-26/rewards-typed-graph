import type { Decomposer, DecomposedQuery } from "../../src/orchestrator/contracts";

export class FakeDecomposer implements Decomposer {
  constructor(private readonly output: DecomposedQuery) {}

  async decompose(_queryText: string): Promise<unknown> {
    return this.output;
  }
}

export class RawDecomposer implements Decomposer {
  constructor(private readonly output: unknown) {}

  async decompose(_queryText: string): Promise<unknown> {
    return this.output;
  }
}

export const PERSONA_QUERY =
  "What's the best use of my Chase Ultimate Rewards for a Tokyo trip in October?";

export const tokyoFixture: DecomposedQuery = {
  invocations: [
    {
      agentType: "wallet_agent",
      operation: {
        kind: "assess_wallet",
        agentType: "wallet_agent",
        programIds: ["program-chase-ur"],
      },
    },
    {
      agentType: "earning_agent",
      operation: {
        kind: "recommend_earning",
        agentType: "earning_agent",
        spendCategoryIds: ["category-travel"],
      },
    },
    {
      agentType: "redemption_agent",
      operation: {
        kind: "traverse_redemption",
        agentType: "redemption_agent",
        goalType: "specific_redemption",
        targetRedemptionOptionId: "option-hyatt-tokyo",
        sourceProgramIds: ["program-chase-ur"],
      },
    },
  ],
};
