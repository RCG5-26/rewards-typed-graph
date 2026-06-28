import type { Agent, AgentContext, SpecialistMutation } from "../../src/agents/contracts";
import { CommitFailure } from "../../src/agents/contracts";

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

  // Faithful double of the production EarningAgent: earning_agent is excluded
  // from the thesis two-specialist flow, so an accidental dispatch must fail
  // loudly in tests too — not silently succeed and diverge from production.
  // Tests that deliberately need a benign third participant (to exercise
  // generic 3-agent orchestration mechanics) use NoOpEarningAgent instead.
  async run(_ctx: AgentContext<"earning_agent">): Promise<void> {
    throw new CommitFailure(
      "ValidationError",
      "earning_agent is not part of the thesis two-specialist flow; " +
        "invoke only wallet_agent and redemption_agent for this milestone",
    );
  }
}

/**
 * Benign no-op in the earning_agent slot. Used only where a test intentionally
 * dispatches a third agent to exercise orchestrator mechanics (ordered runs,
 * null-state runs from a non-committing agent). It is NOT a production double —
 * use FakeEarningAgent for production-fidelity behavior.
 */
export class NoOpEarningAgent implements Agent<"earning_agent"> {
  readonly agentType = "earning_agent" as const;

  async run(_ctx: AgentContext<"earning_agent">): Promise<void> {
    return;
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
