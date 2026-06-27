/**
 * M4 — Agent run lifecycle repository.
 *
 * Implements the createAgentRun / finalizeAgentRun slice of OrchestratorGraphWrite.
 * All writes go through PythonWriteBridge (no direct TypeScript SQL).
 *
 * The plan-lifecycle methods (createPlan, transitionPlanStatus) are also
 * delegated to the bridge — they exist here so PgOrchestratorGraphWrite can
 * assemble a complete OrchestratorGraphWrite from this single class.
 */

import type { AgentType } from "../../agents/contracts";
import type {
  AgentRunRecord,
  OrchestratorGraphWrite,
  PlanRecord,
} from "../contracts";
import type { PythonWriteBridge } from "../../agents/commit/python-write-bridge";

export class AgentRunRepository implements OrchestratorGraphWrite {
  constructor(private readonly bridge: PythonWriteBridge) {}

  async createPlan(input: {
    userId: string;
    planLineageId: string;
    queryText: string;
  }): Promise<PlanRecord> {
    const result = await this.bridge.createPlan(input);

    return {
      id: result.planId,
      planLineageId: result.planLineageId,
      revisionNumber: result.revisionNumber,
      queryText: input.queryText,
      status: "generating",
      planType: "agent_generated",
    };
  }

  async transitionPlanStatus(input: {
    planId: string;
    toStatus: "current" | "failed";
  }): Promise<void> {
    await this.bridge.transitionPlanStatus(input);
  }

  async createAgentRun(input: {
    planId: string;
    userId: string;
    agentType: AgentType;
  }): Promise<AgentRunRecord> {
    const result = await this.bridge.createAgentRun(input);

    return {
      id: result.agentRunId,
      agentType: input.agentType,
      planId: input.planId,
      userId: input.userId,
      status: "running",
      state: null,
      error: null,
    };
  }

  async finalizeAgentRun(input: {
    agentRunId: string;
    status: "completed" | "failed";
    error?: string;
  }): Promise<void> {
    await this.bridge.finalizeAgentRun(input);
  }
}
