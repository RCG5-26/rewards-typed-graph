import type { Agent, AgentContext, SpecialistMutation } from "../../src/agents/contracts";

export class FakeWalletAgent implements Agent<"wallet_agent"> {
  readonly agentType = "wallet_agent" as const;

  async run(ctx: AgentContext<"wallet_agent">): Promise<void> {
    const programId = ctx.operation.programIds[0];
    const target = ctx.snapshot.userBalances.find((b) => b.programId === programId);
    if (!target) throw new Error(`wallet_agent: no balance for ${programId}`);
    await ctx.commit({
      mutation: {
        kind: "UpdateUserBalance",
        balanceNodeId: target.id,
        balancePoints: target.balancePoints,
      },
      readSet: { [target.id]: target.version },
      idempotencyKey: `${ctx.agentRunId}:0`,
    });
  }
}

export class FakeEarningAgent implements Agent<"earning_agent"> {
  readonly agentType = "earning_agent" as const;

  async run(ctx: AgentContext<"earning_agent">): Promise<void> {
    await ctx.commit({
      mutation: {
        kind: "CreatePlanStep",
        planId: ctx.planId,
        stepOrder: 1,
        stepType: "spend_analysis",
        payload: {
          spendCategoryId: ctx.operation.spendCategoryIds[0],
          recommendedCardId: "card-csp",
        },
      },
      readSet: { "balance-chase-ur": 2, "card-csp": 0 },
      idempotencyKey: `${ctx.agentRunId}:0`,
    });
  }
}

export class FakeRedemptionAgent implements Agent<"redemption_agent"> {
  readonly agentType = "redemption_agent" as const;

  async run(ctx: AgentContext<"redemption_agent">): Promise<void> {
    await ctx.commit({
      mutation: {
        kind: "CreatePlanStep",
        planId: ctx.planId,
        stepOrder: 2,
        stepType: "redemption_recommendation",
        payload: {
          redemptionOptionId: ctx.operation.targetRedemptionOptionId ?? "option-unspecified",
          sourceProgramId: ctx.operation.sourceProgramIds[0],
        },
      },
      readSet: { "balance-chase-ur": 2, "route-chase-hyatt": 5 },
      idempotencyKey: `${ctx.agentRunId}:0`,
    });
  }
}

export class FailingEarningAgent implements Agent<"earning_agent"> {
  readonly agentType = "earning_agent" as const;

  async run(_ctx: AgentContext<"earning_agent">): Promise<void> {
    throw new Error("earning_agent_error: external data unavailable");
  }
}

export class WalletAgentSubmittingDependency implements Agent<"wallet_agent"> {
  readonly agentType = "wallet_agent" as const;

  async run(ctx: AgentContext<"wallet_agent">): Promise<void> {
    await ctx.commit({
      mutation: {
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
      } as unknown as SpecialistMutation,
      readSet: { "balance-chase-ur": 2 },
      idempotencyKey: `${ctx.agentRunId}:0`,
    });
  }
}

export class SpecialistNamingPlanCommand implements Agent<"wallet_agent"> {
  readonly agentType = "wallet_agent" as const;

  async run(ctx: AgentContext<"wallet_agent">): Promise<void> {
    await ctx.commit({
      mutation: {
        kind: "CreatePlan",
        userId: ctx.userId,
        planLineageId: "lineage-1",
        queryText: "hack",
      } as unknown as SpecialistMutation,
      readSet: {},
      idempotencyKey: `${ctx.agentRunId}:0`,
    });
  }
}
