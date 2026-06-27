/**
 * Contract tests for ControlledAgentCommitFactory (M3).
 *
 * Verifies:
 *  1. validateCommitInput runs before any bridge call (Contract 4 gate)
 *  2. Correct bridge method is dispatched for each mutation kind
 *  3. CommitSuccess is formed correctly from bridge result
 *  4. IdempotencyConflict bridge error is surfaced as CommitSuccess(replayed)
 *  5. Other CommitFailure kinds propagate unchanged
 *  6. Ownership enforcement (wallet cannot submit RecordStateDependency)
 *  7. No direct SQL writes — bridge is the only call on success path
 */

import { describe, expect, it, vi } from "vitest";

import type { AgentCommitInput, SpecialistMutation } from "../contracts";
import { CommitFailure } from "../contracts";
import { ControlledAgentCommitFactory } from "./controlled-commit";
import type { MutationCommitResult, PythonWriteBridgeOptions } from "./python-write-bridge";
import { PythonWriteBridge } from "./python-write-bridge";

const BASE_BINDING = {
  userId: "user-1",
  planId: "plan-1",
  agentRunId: "run-1",
  agentType: "wallet_agent" as const,
};

const REDEMPTION_BINDING = {
  ...BASE_BINDING,
  agentType: "redemption_agent" as const,
};

function makeInput(mutation: SpecialistMutation): AgentCommitInput {
  return {
    mutation,
    readSet: { "balance-1": 3 },
    idempotencyKey: "test-key-abc",
  };
}

const UPDATE_BALANCE_MUTATION: SpecialistMutation = {
  kind: "UpdateUserBalance",
  balanceNodeId: "balance-1",
  balancePoints: 50_000,
};

const CREATE_STEP_MUTATION: SpecialistMutation = {
  kind: "CreatePlanStep",
  planId: "plan-1",
  stepOrder: 1,
  stepType: "redemption_recommendation",
  payload: { redemptionOptionId: "f001", sourceProgramId: "b001" },
};

const RECORD_DEP_MUTATION: SpecialistMutation = {
  kind: "RecordStateDependency",
  planStepId: "step-1",
  targetNodeId: "balance-1",
  observedVersion: 3,
  target: {
    targetNodeType: "UserBalance",
    targetTable: "user_balances",
    dependedProperty: "balance_points",
    snapshotValue: { balancePoints: 50_000 },
  },
};

function mockBridge(overrides: Partial<{
  commitMutation: (params: unknown) => Promise<MutationCommitResult>;
}> = {}): PythonWriteBridge {
  const bridge = new PythonWriteBridge({ scriptPath: "/dev/null" });
  vi.spyOn(bridge, "commitMutation").mockImplementation(
    overrides.commitMutation ??
      (() => Promise.resolve({ mutationTxnId: "txn-abc", idempotencyReplayed: false })),
  );
  return bridge;
}

describe("ControlledAgentCommitFactory", () => {
  describe("validation gate (Contract 4)", () => {
    it("rejects empty idempotencyKey before calling bridge", async () => {
      const bridge = mockBridge();
      const factory = new ControlledAgentCommitFactory(bridge);
      const commit = factory.create(BASE_BINDING);

      await expect(
        commit({ ...makeInput(UPDATE_BALANCE_MUTATION), idempotencyKey: "" }),
      ).rejects.toThrow(CommitFailure);

      expect(bridge.commitMutation).not.toHaveBeenCalled();
    });

    it("rejects mutation with negative readSet version before calling bridge", async () => {
      const bridge = mockBridge();
      const factory = new ControlledAgentCommitFactory(bridge);
      const commit = factory.create(BASE_BINDING);

      await expect(
        commit({ ...makeInput(UPDATE_BALANCE_MUTATION), readSet: { "balance-1": -1 } }),
      ).rejects.toThrow(CommitFailure);

      expect(bridge.commitMutation).not.toHaveBeenCalled();
    });

    it("rejects ownership violation (wallet_agent cannot submit RecordStateDependency)", async () => {
      const bridge = mockBridge();
      const factory = new ControlledAgentCommitFactory(bridge);
      const commit = factory.create(BASE_BINDING); // wallet_agent

      await expect(
        commit(makeInput(RECORD_DEP_MUTATION)),
      ).rejects.toMatchObject({
        kind: "OwnershipError",
      });

      expect(bridge.commitMutation).not.toHaveBeenCalled();
    });

    it("rejects CreatePlanStep when planId does not match binding", async () => {
      const bridge = mockBridge();
      const factory = new ControlledAgentCommitFactory(bridge);
      const commit = factory.create(REDEMPTION_BINDING);

      const wrongPlanMutation: SpecialistMutation = {
        ...CREATE_STEP_MUTATION,
        planId: "other-plan",
      };

      await expect(commit(makeInput(wrongPlanMutation))).rejects.toMatchObject({
        kind: "ValidationError",
      });

      expect(bridge.commitMutation).not.toHaveBeenCalled();
    });
  });

  describe("bridge dispatch", () => {
    it("calls bridge.commitMutation with correct params for UpdateUserBalance", async () => {
      const bridge = mockBridge();
      const factory = new ControlledAgentCommitFactory(bridge);
      const commit = factory.create(BASE_BINDING);

      const input = makeInput(UPDATE_BALANCE_MUTATION);
      await commit(input);

      expect(bridge.commitMutation).toHaveBeenCalledWith({
        mutation: UPDATE_BALANCE_MUTATION,
        userId: "user-1",
        planId: "plan-1",
        agentRunId: "run-1",
        agentType: "wallet_agent",
        idempotencyKey: "test-key-abc",
        readSet: { "balance-1": 3 },
      });
    });

    it("calls bridge.commitMutation with correct params for CreatePlanStep", async () => {
      const bridge = mockBridge();
      const factory = new ControlledAgentCommitFactory(bridge);
      const commit = factory.create(REDEMPTION_BINDING);

      await commit(makeInput(CREATE_STEP_MUTATION));

      expect(bridge.commitMutation).toHaveBeenCalledWith(
        expect.objectContaining({
          mutation: CREATE_STEP_MUTATION,
          planId: "plan-1",
          agentType: "redemption_agent",
        }),
      );
    });

    it("calls bridge.commitMutation for RecordStateDependency", async () => {
      const bridge = mockBridge();
      const factory = new ControlledAgentCommitFactory(bridge);
      const commit = factory.create(REDEMPTION_BINDING);

      await commit(makeInput(RECORD_DEP_MUTATION));

      expect(bridge.commitMutation).toHaveBeenCalledWith(
        expect.objectContaining({ mutation: RECORD_DEP_MUTATION }),
      );
    });
  });

  describe("CommitSuccess formation", () => {
    it("returns CommitSuccess with mutationTxnId from bridge", async () => {
      const bridge = mockBridge({
        commitMutation: () => Promise.resolve({ mutationTxnId: "txn-xyz", idempotencyReplayed: false }),
      });
      const factory = new ControlledAgentCommitFactory(bridge);
      const commit = factory.create(BASE_BINDING);

      const result = await commit(makeInput(UPDATE_BALANCE_MUTATION));

      expect(result.mutationTxnId).toBe("txn-xyz");
      expect(result.idempotencyReplayed).toBe(false);
    });

    it("surfaces idempotencyReplayed: true from bridge result", async () => {
      const bridge = mockBridge({
        commitMutation: () => Promise.resolve({ mutationTxnId: "txn-orig", idempotencyReplayed: true }),
      });
      const factory = new ControlledAgentCommitFactory(bridge);
      const commit = factory.create(BASE_BINDING);

      const result = await commit(makeInput(UPDATE_BALANCE_MUTATION));

      expect(result.idempotencyReplayed).toBe(true);
    });

    it("converts bridge IdempotencyConflict error to CommitSuccess(replayed)", async () => {
      const bridge = mockBridge({
        commitMutation: () => Promise.reject(new CommitFailure("IdempotencyConflict", "already committed")),
      });
      const factory = new ControlledAgentCommitFactory(bridge);
      const commit = factory.create(BASE_BINDING);

      const result = await commit(makeInput(UPDATE_BALANCE_MUTATION));

      expect(result.idempotencyReplayed).toBe(true);
      expect(result.mutationTxnId).toContain("idempotent-replay:");
    });
  });

  describe("error propagation", () => {
    it("propagates ConflictError from bridge unchanged", async () => {
      const bridge = mockBridge({
        commitMutation: () => Promise.reject(new CommitFailure("ConflictError", "stale version")),
      });
      const factory = new ControlledAgentCommitFactory(bridge);
      const commit = factory.create(BASE_BINDING);

      await expect(commit(makeInput(UPDATE_BALANCE_MUTATION))).rejects.toMatchObject({
        kind: "ConflictError",
      });
    });

    it("propagates ValidationError from bridge unchanged", async () => {
      const bridge = mockBridge({
        commitMutation: () => Promise.reject(new CommitFailure("ValidationError", "bad payload")),
      });
      const factory = new ControlledAgentCommitFactory(bridge);
      const commit = factory.create(BASE_BINDING);

      await expect(commit(makeInput(UPDATE_BALANCE_MUTATION))).rejects.toMatchObject({
        kind: "ValidationError",
      });
    });

    it("propagates UnexpectedCommitError from bridge unchanged", async () => {
      const bridge = mockBridge({
        commitMutation: () => Promise.reject(new CommitFailure("UnexpectedCommitError", "bridge died")),
      });
      const factory = new ControlledAgentCommitFactory(bridge);
      const commit = factory.create(BASE_BINDING);

      await expect(commit(makeInput(UPDATE_BALANCE_MUTATION))).rejects.toMatchObject({
        kind: "UnexpectedCommitError",
      });
    });
  });
});
