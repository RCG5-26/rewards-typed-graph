/**
 * Contract tests for RedemptionAgent (M2).
 *
 * Covers:
 *  - Initial state: Hyatt=30k < 45k threshold → transfer_recommendation + Chase dependency
 *  - Post-transfer state: Hyatt=60k ≥ 45k → redemption_recommendation + Hyatt dependency
 *  - Insufficient total points → redemption step with Hyatt dependency
 *  - RecordStateDependency always emitted (thesis structural-invalidation proof)
 *  - planStepId from CreatePlanStep result is threaded to RecordStateDependency
 *  - Invalid input rejection
 *  - Deterministic idempotency key stability
 */

import { describe, expect, it, vi } from "vitest";
import type { AgentCommitInput } from "../contracts";
import { CommitFailure } from "../contracts";
import { RedemptionAgent } from "./redemption-agent";
import type { AgentContext } from "../contracts";
import type { RedemptionTraversalOperation } from "../../orchestrator/contracts";

const B001 = "00000000-0000-0000-0000-00000000b001"; // Chase UR
const B002 = "00000000-0000-0000-0000-00000000b002"; // Hyatt
const D001 = "00000000-0000-0000-0000-00000000d001"; // Chase UR balance node
const D002 = "00000000-0000-0000-0000-00000000d002"; // Hyatt balance node
const F001 = "00000000-0000-0000-0000-00000000f001"; // Hyatt Ginza redemption option

function makeOperation(sourceProgramIds = [B001, B002]): RedemptionTraversalOperation {
  return {
    kind: "traverse_redemption",
    agentType: "redemption_agent",
    goalType: "specific_redemption",
    targetRedemptionOptionId: F001,
    sourceProgramIds,
  };
}

type CommitCall = { mutation: AgentCommitInput["mutation"]; readSet: AgentCommitInput["readSet"]; idempotencyKey: string };

function makeContext(
  hyattPoints: number,
  chasePoints: number,
  hyattVersion = 1,
  chaseVersion = 1,
): AgentContext<"redemption_agent"> & { calls: CommitCall[] } {
  const calls: CommitCall[] = [];
  let callIndex = 0;

  return {
    planId: "plan-1",
    userId: "user-1",
    agentRunId: "run-1",
    operation: makeOperation(),
    snapshot: {
      userBalances: [
        { id: D001, programId: B001, balancePoints: chasePoints, version: chaseVersion },
        { id: D002, programId: B002, balancePoints: hyattPoints, version: hyattVersion },
      ],
      userGoals: [],
      userProgramStatuses: [],
    },
    commit: vi.fn().mockImplementation((input: AgentCommitInput) => {
      calls.push({ mutation: input.mutation, readSet: input.readSet, idempotencyKey: input.idempotencyKey });
      const txnId = `txn-step-${++callIndex}`;
      return Promise.resolve({ mutationTxnId: txnId, idempotencyReplayed: false });
    }),
    calls,
  };
}

describe("RedemptionAgent", () => {
  describe("initial state (Hyatt=30k < 45k threshold)", () => {
    it("emits transfer_recommendation when Hyatt is short but Chase can cover", async () => {
      const agent = new RedemptionAgent();
      const ctx = makeContext(30_000, 180_000);

      await agent.run(ctx);

      expect(ctx.calls).toHaveLength(2);
      expect(ctx.calls[0].mutation.kind).toBe("CreatePlanStep");
      expect((ctx.calls[0].mutation as { stepType: string }).stepType).toBe("transfer_recommendation");
      expect((ctx.calls[0].mutation as { payload: { fromProgramId: string } }).payload.fromProgramId).toBe(B001);
      expect((ctx.calls[0].mutation as { payload: { toProgramId: string } }).payload.toProgramId).toBe(B002);
    });

    it("records dependency on Chase UR (the funding source) for transfer step", async () => {
      const agent = new RedemptionAgent();
      const ctx = makeContext(30_000, 180_000);

      await agent.run(ctx);

      const dep = ctx.calls[1].mutation;
      expect(dep.kind).toBe("RecordStateDependency");
      expect((dep as { targetNodeId: string }).targetNodeId).toBe(D001); // Chase UR
      expect((dep as { observedVersion: number }).observedVersion).toBe(1);
      expect((dep as { target: { dependedProperty: string } }).target.dependedProperty).toBe("balance_points");
    });

    it("threads CreatePlanStep result mutationTxnId into RecordStateDependency.planStepId", async () => {
      const agent = new RedemptionAgent();
      const ctx = makeContext(30_000, 180_000);

      await agent.run(ctx);

      const dep = ctx.calls[1].mutation as { planStepId: string };
      // First commit call returned "txn-step-1" as mutationTxnId
      expect(dep.planStepId).toBe("txn-step-1");
    });

    it("readSet for transfer step includes both Chase and Hyatt balances", async () => {
      const agent = new RedemptionAgent();
      const ctx = makeContext(30_000, 180_000);

      await agent.run(ctx);

      expect(ctx.calls[0].readSet).toEqual({
        [D001]: 1, // Chase
        [D002]: 1, // Hyatt
      });
    });
  });

  describe("post-transfer state (Hyatt=60k ≥ 45k threshold)", () => {
    it("emits redemption_recommendation when Hyatt meets threshold", async () => {
      const agent = new RedemptionAgent();
      const ctx = makeContext(60_000, 150_000, 2, 2);

      await agent.run(ctx);

      expect(ctx.calls).toHaveLength(2);
      expect(ctx.calls[0].mutation.kind).toBe("CreatePlanStep");
      expect((ctx.calls[0].mutation as { stepType: string }).stepType).toBe("redemption_recommendation");
      expect((ctx.calls[0].mutation as { payload: { sourceProgramId: string } }).payload.sourceProgramId).toBe(B002);
    });

    it("records dependency on Hyatt balance for direct redemption", async () => {
      const agent = new RedemptionAgent();
      const ctx = makeContext(60_000, 150_000, 2, 2);

      await agent.run(ctx);

      const dep = ctx.calls[1].mutation as { targetNodeId: string };
      expect(dep.targetNodeId).toBe(D002); // Hyatt
    });

    it("snapshotValue reflects the current Hyatt balance (60k)", async () => {
      const agent = new RedemptionAgent();
      const ctx = makeContext(60_000, 150_000, 2, 2);

      await agent.run(ctx);

      const dep = ctx.calls[1].mutation as { target: { snapshotValue: unknown } };
      expect(dep.target.snapshotValue).toEqual({ balancePoints: 60_000 });
    });

    it("does NOT recommend Chase→Hyatt transfer after threshold is met", async () => {
      const agent = new RedemptionAgent();
      const ctx = makeContext(60_000, 150_000, 2, 2);

      await agent.run(ctx);

      const step = ctx.calls[0].mutation as { stepType: string };
      expect(step.stepType).not.toBe("transfer_recommendation");
    });
  });

  describe("insufficient total points", () => {
    it("emits redemption_recommendation stub with Hyatt dependency when insufficient", async () => {
      const agent = new RedemptionAgent();
      const ctx = makeContext(5_000, 10_000); // total = 15k < 45k

      await agent.run(ctx);

      expect(ctx.calls).toHaveLength(2);
      expect((ctx.calls[0].mutation as { stepType: string }).stepType).toBe(
        "redemption_recommendation",
      );
      expect((ctx.calls[1].mutation as { targetNodeId: string }).targetNodeId).toBe(D002); // Hyatt
    });
  });

  describe("RecordStateDependency structural invariants", () => {
    it("always emits exactly 2 commits (step + dependency)", async () => {
      const agent = new RedemptionAgent();
      for (const [hyatt, chase] of [[60_000, 0], [30_000, 180_000], [1_000, 2_000]]) {
        const ctx = makeContext(hyatt, chase);
        await agent.run(ctx);
        expect(ctx.calls).toHaveLength(2);
      }
    });

    it("RecordStateDependency targets user_balances table", async () => {
      const agent = new RedemptionAgent();
      const ctx = makeContext(30_000, 180_000);

      await agent.run(ctx);

      const dep = ctx.calls[1].mutation as { target: { targetTable: string } };
      expect(dep.target.targetTable).toBe("user_balances");
    });

    it("RecordStateDependency target has targetNodeType UserBalance", async () => {
      const agent = new RedemptionAgent();
      const ctx = makeContext(30_000, 180_000);

      await agent.run(ctx);

      const dep = ctx.calls[1].mutation as { target: { targetNodeType: string } };
      expect(dep.target.targetNodeType).toBe("UserBalance");
    });
  });

  describe("idempotency key stability", () => {
    it("same inputs produce same idempotency key on repeat calls", async () => {
      const agent = new RedemptionAgent();
      const ctxA = makeContext(30_000, 180_000);
      const ctxB = makeContext(30_000, 180_000);

      await agent.run(ctxA);
      await agent.run(ctxB);

      expect(ctxA.calls[0].idempotencyKey).toBe(ctxB.calls[0].idempotencyKey);
      expect(ctxA.calls[1].idempotencyKey).toBe(ctxB.calls[1].idempotencyKey);
    });

    it("different planId produces different idempotency key", async () => {
      const agent = new RedemptionAgent();
      const ctxA = makeContext(30_000, 180_000);
      const ctxB = { ...ctxA, planId: "plan-2", calls: [] as CommitCall[] };
      ctxB.commit = vi.fn().mockImplementation((input: AgentCommitInput) => {
        ctxB.calls.push({ mutation: input.mutation, readSet: input.readSet, idempotencyKey: input.idempotencyKey });
        return Promise.resolve({ mutationTxnId: "txn-step-1", idempotencyReplayed: false });
      });

      await agent.run(ctxA);
      await agent.run(ctxB);

      expect(ctxA.calls[0].idempotencyKey).not.toBe(ctxB.calls[0].idempotencyKey);
    });
  });

  describe("invalid input rejection", () => {
    it("throws ValidationError when snapshot has no Hyatt balance", async () => {
      const agent = new RedemptionAgent();
      const ctx: AgentContext<"redemption_agent"> = {
        planId: "plan-1",
        userId: "user-1",
        agentRunId: "run-1",
        operation: makeOperation(),
        snapshot: {
          userBalances: [{ id: D001, programId: B001, balancePoints: 180_000, version: 1 }],
          userGoals: [],
          userProgramStatuses: [],
        },
        commit: vi.fn(),
      };

      await expect(agent.run(ctx)).rejects.toMatchObject({ kind: "ValidationError" });
    });

    it("throws ValidationError when operation has empty sourceProgramIds", async () => {
      const agent = new RedemptionAgent();
      const ctx: AgentContext<"redemption_agent"> = {
        planId: "plan-1",
        userId: "user-1",
        agentRunId: "run-1",
        operation: {
          kind: "traverse_redemption",
          agentType: "redemption_agent",
          goalType: "specific_redemption",
          targetRedemptionOptionId: F001,
          sourceProgramIds: [],
        },
        snapshot: {
          userBalances: [
            { id: D001, programId: B001, balancePoints: 180_000, version: 1 },
            { id: D002, programId: B002, balancePoints: 30_000, version: 1 },
          ],
          userGoals: [],
          userProgramStatuses: [],
        },
        commit: vi.fn(),
      };

      await expect(agent.run(ctx)).rejects.toMatchObject({ kind: "ValidationError" });
    });
  });
});
