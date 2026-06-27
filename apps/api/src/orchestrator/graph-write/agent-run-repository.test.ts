/**
 * Contract tests for AgentRunRepository (M4).
 */

import { describe, expect, it, vi } from "vitest";
import { AgentRunRepository } from "./agent-run-repository";
import type { PythonWriteBridge } from "../../agents/commit/python-write-bridge";

function mockBridge(): PythonWriteBridge {
  return {
    createPlan: vi.fn().mockResolvedValue({
      planId: "plan-123",
      planLineageId: "lineage-456",
      revisionNumber: 1,
    }),
    transitionPlanStatus: vi.fn().mockResolvedValue(undefined),
    createAgentRun: vi.fn().mockResolvedValue({ agentRunId: "run-789" }),
    finalizeAgentRun: vi.fn().mockResolvedValue(undefined),
    commitMutation: vi.fn(),
  } as unknown as PythonWriteBridge;
}

describe("AgentRunRepository", () => {
  describe("createPlan", () => {
    it("returns a PlanRecord with status generating", async () => {
      const bridge = mockBridge();
      const repo = new AgentRunRepository(bridge);

      const record = await repo.createPlan({
        userId: "user-1",
        planLineageId: "lineage-456",
        queryText: "book a flight",
      });

      expect(record.id).toBe("plan-123");
      expect(record.planLineageId).toBe("lineage-456");
      expect(record.revisionNumber).toBe(1);
      expect(record.status).toBe("generating");
      expect(record.planType).toBe("agent_generated");
    });

    it("delegates to bridge.createPlan with correct params", async () => {
      const bridge = mockBridge();
      const repo = new AgentRunRepository(bridge);

      await repo.createPlan({
        userId: "user-1",
        planLineageId: "lineage-abc",
        queryText: "maximize points",
      });

      expect(bridge.createPlan).toHaveBeenCalledWith({
        userId: "user-1",
        planLineageId: "lineage-abc",
        queryText: "maximize points",
      });
    });
  });

  describe("transitionPlanStatus", () => {
    it("delegates to bridge.transitionPlanStatus", async () => {
      const bridge = mockBridge();
      const repo = new AgentRunRepository(bridge);

      await repo.transitionPlanStatus({ planId: "plan-1", toStatus: "current" });

      expect(bridge.transitionPlanStatus).toHaveBeenCalledWith({
        planId: "plan-1",
        toStatus: "current",
      });
    });
  });

  describe("createAgentRun", () => {
    it("returns an AgentRunRecord with status running", async () => {
      const bridge = mockBridge();
      const repo = new AgentRunRepository(bridge);

      const record = await repo.createAgentRun({
        planId: "plan-1",
        userId: "user-1",
        agentType: "wallet_agent",
      });

      expect(record.id).toBe("run-789");
      expect(record.status).toBe("running");
      expect(record.agentType).toBe("wallet_agent");
      expect(record.state).toBeNull();
      expect(record.error).toBeNull();
    });

    it("delegates to bridge.createAgentRun with correct params", async () => {
      const bridge = mockBridge();
      const repo = new AgentRunRepository(bridge);

      await repo.createAgentRun({
        planId: "plan-1",
        userId: "user-1",
        agentType: "redemption_agent",
      });

      expect(bridge.createAgentRun).toHaveBeenCalledWith({
        planId: "plan-1",
        userId: "user-1",
        agentType: "redemption_agent",
      });
    });
  });

  describe("finalizeAgentRun", () => {
    it("delegates completed status to bridge", async () => {
      const bridge = mockBridge();
      const repo = new AgentRunRepository(bridge);

      await repo.finalizeAgentRun({ agentRunId: "run-1", status: "completed" });

      expect(bridge.finalizeAgentRun).toHaveBeenCalledWith({
        agentRunId: "run-1",
        status: "completed",
      });
    });

    it("delegates failed status with error to bridge", async () => {
      const bridge = mockBridge();
      const repo = new AgentRunRepository(bridge);

      await repo.finalizeAgentRun({
        agentRunId: "run-1",
        status: "failed",
        error: "commit validation failed",
      });

      expect(bridge.finalizeAgentRun).toHaveBeenCalledWith({
        agentRunId: "run-1",
        status: "failed",
        error: "commit validation failed",
      });
    });
  });
});
