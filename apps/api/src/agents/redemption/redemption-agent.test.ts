/**
 * Contract tests for RedemptionAgent (M2).
 *
 * Covers:
 *  - Initial state: Hyatt=30k < 45k threshold → transfer_recommendation + Chase dependency
 *  - Post-transfer state: Hyatt=60k ≥ 45k → redemption_recommendation + Hyatt dependency
 *  - Insufficient total points → no step (cash fallback; no unaffordable award)
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

      expect(ctx.calls).toHaveLength(4);
      expect(ctx.calls[0].mutation.kind).toBe("CreatePlanStep");
      expect((ctx.calls[0].mutation as { stepType: string }).stepType).toBe("transfer_recommendation");
      expect((ctx.calls[0].mutation as { payload: { fromProgramId: string } }).payload.fromProgramId).toBe(B001);
      expect((ctx.calls[0].mutation as { payload: { toProgramId: string } }).payload.toProgramId).toBe(B002);
    });

    it("also emits a redemption_recommendation (order 2) so rev1 is a complete, goal-satisfying plan", async () => {
      const agent = new RedemptionAgent();
      const ctx = makeContext(30_000, 180_000);

      await agent.run(ctx);

      const redemptionStep = ctx.calls[2].mutation;
      expect(redemptionStep.kind).toBe("CreatePlanStep");
      expect((redemptionStep as { stepType: string }).stepType).toBe("redemption_recommendation");
      expect((redemptionStep as { stepOrder: number }).stepOrder).toBe(2);
      expect((redemptionStep as { payload: { redemptionOptionId: string } }).payload.redemptionOptionId).toBe(F001);
      expect((redemptionStep as { payload: { sourceProgramId: string } }).payload.sourceProgramId).toBe(B002);
    });

    it("writes human-readable action text on each step for PlanView projection", async () => {
      const agent = new RedemptionAgent();
      const ctx = makeContext(30_000, 180_000);

      await agent.run(ctx);

      const transferPayload = (ctx.calls[0].mutation as { payload: { action?: string; reasoning?: string } })
        .payload;
      expect(transferPayload.action).toBe(
        "Transfer 15,000 Chase Ultimate Rewards points to World of Hyatt.",
      );
      expect(transferPayload.reasoning).toContain("15,000");

      const redemptionPayload = (ctx.calls[2].mutation as { payload: { action?: string; reasoning?: string } })
        .payload;
      expect(redemptionPayload.action).toBe(
        "Book Demo Hyatt Ginza 3-night Tokyo award for 45,000 Hyatt points.",
      );
      expect(redemptionPayload.reasoning).toContain("Chase transfer");
    });

    it("anchors the rev1 redemption step on the Hyatt balance (the redeeming program)", async () => {
      const agent = new RedemptionAgent();
      const ctx = makeContext(30_000, 180_000);

      await agent.run(ctx);

      const dep = ctx.calls[3].mutation;
      expect(dep.kind).toBe("RecordStateDependency");
      expect((dep as { targetNodeId: string }).targetNodeId).toBe(D002); // Hyatt
      // planStepId threads from the redemption CreatePlanStep (third commit → txn-step-3).
      expect((dep as { planStepId: string }).planStepId).toBe("txn-step-3");
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

    it("readSet for direct redemption excludes Chase (depends on Hyatt alone)", async () => {
      const agent = new RedemptionAgent();
      const ctx = makeContext(60_000, 150_000, 2, 3);

      await agent.run(ctx);

      // Only Hyatt is in the read-set: a Chase version bump must not invalidate
      // a direct-redemption step that never depended on Chase.
      expect(ctx.calls[0].readSet).toEqual({ [D002]: 2 });
      expect(ctx.calls[0].readSet).not.toHaveProperty(D001);
    });
  });

  describe("insufficient total points", () => {
    it("emits NO plan step when no award is fundable (cash fallback, not an unaffordable redemption)", async () => {
      const agent = new RedemptionAgent();
      const ctx = makeContext(5_000, 10_000); // total = 15k < 45k

      await agent.run(ctx);

      // The graph must not recommend an award it cannot fund. Emitting nothing
      // yields a step-less plan the comparison renders as a cash fallback —
      // honest infeasibility instead of an overspending redemption stub.
      expect(ctx.calls).toHaveLength(0);
    });

    it("emits nothing even when Chase holds points but no route can fund the gap", async () => {
      const agent = new RedemptionAgent();
      // Hyatt 20k, Chase 20k: combined 40k still < the 45k award minimum.
      const ctx = makeContext(20_000, 20_000);

      await agent.run(ctx);

      expect(ctx.calls).toHaveLength(0);
    });
  });

  describe("RecordStateDependency structural invariants", () => {
    it("emits a step+dependency pair per plan step (2 commits per step)", async () => {
      const agent = new RedemptionAgent();
      // [hyatt, chase, expectedCommits]: direct redeem emits one step (2 commits);
      // the transfer-first branch emits transfer + redemption (4 commits) so rev1
      // is a complete plan; the insufficient branch emits nothing (cash fallback).
      const scenarios: [number, number, number][] = [
        [60_000, 0, 2], // direct redeem (Hyatt already ≥ threshold)
        [30_000, 180_000, 4], // transfer + redemption
        [1_000, 2_000, 0], // insufficient total → no step (cash fallback)
      ];
      for (const [hyatt, chase, expected] of scenarios) {
        const ctx = makeContext(hyatt, chase);
        await agent.run(ctx);
        expect(ctx.calls).toHaveLength(expected);
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

    it("rejects a non-demo targetRedemptionOptionId instead of rewriting it to Hyatt", async () => {
      const agent = new RedemptionAgent();
      const base = makeContext(60_000, 150_000, 2, 2);
      const ctx = {
        ...base,
        operation: {
          ...makeOperation(),
          targetRedemptionOptionId: "00000000-0000-0000-0000-0000000000ff", // not Hyatt f001
        },
      };

      await expect(agent.run(ctx)).rejects.toMatchObject({ kind: "ValidationError" });
      expect(base.calls).toHaveLength(0);
    });

    it("rejects an unsupported sourceProgramId outside the Hyatt/Chase demo set", async () => {
      const agent = new RedemptionAgent();
      const base = makeContext(60_000, 150_000, 2, 2);
      const ctx = {
        ...base,
        operation: makeOperation([B002, "00000000-0000-0000-0000-0000000000aa"]),
      };

      await expect(agent.run(ctx)).rejects.toMatchObject({ kind: "ValidationError" });
      expect(base.calls).toHaveLength(0);
    });
  });
});
