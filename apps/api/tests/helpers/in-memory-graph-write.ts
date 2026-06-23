import type { AgentType } from "../../src/agents/contracts";
import type {
  AgentRunRecord,
  OrchestratorGraphWrite,
  PlanRecord,
} from "../../src/orchestrator/contracts";

export class InMemoryOrchestratorGraphWrite implements OrchestratorGraphWrite {
  readonly plans = new Map<string, PlanRecord>();
  readonly agentRuns = new Map<string, AgentRunRecord>();
  readonly commandCounts = {
    createPlan: 0,
    transitionPlanStatus: 0,
    createAgentRun: 0,
    finalizeAgentRun: 0,
  };

  private throwOnCreateAgentRun: Error | null = null;
  private throwOnFinalizeCompleted: Error | null = null;
  private throwOnFinalizeFailed: Error | null = null;
  private throwOnTransitionFailed: Error | null = null;

  setThrowOnCreateAgentRun(error: Error): void {
    this.throwOnCreateAgentRun = error;
  }

  setThrowOnFinalizeCompleted(error: Error): void {
    this.throwOnFinalizeCompleted = error;
  }

  setThrowOnFinalizeFailed(error: Error): void {
    this.throwOnFinalizeFailed = error;
  }

  setThrowOnTransitionFailed(error: Error): void {
    this.throwOnTransitionFailed = error;
  }

  async createPlan(input: {
    userId: string;
    planLineageId: string;
    queryText: string;
  }): Promise<PlanRecord> {
    this.commandCounts.createPlan += 1;
    const id = crypto.randomUUID();
    const plan: PlanRecord = {
      id,
      planLineageId: input.planLineageId,
      revisionNumber: 1,
      queryText: input.queryText,
      status: "generating",
      planType: "agent_generated",
    };
    this.plans.set(id, plan);
    return plan;
  }

  async transitionPlanStatus(input: {
    planId: string;
    toStatus: "current" | "failed";
  }): Promise<void> {
    if (input.toStatus === "failed" && this.throwOnTransitionFailed) {
      const error = this.throwOnTransitionFailed;
      this.throwOnTransitionFailed = null;
      throw error;
    }

    this.commandCounts.transitionPlanStatus += 1;
    const plan = this.plans.get(input.planId);
    if (!plan) throw new Error(`Plan not found: ${input.planId}`);

    if (input.toStatus === "current") {
      for (const other of this.plans.values()) {
        if (
          other.planLineageId === plan.planLineageId &&
          other.id !== plan.id &&
          other.status === "current"
        ) {
          throw new Error("plans_one_current_revision violated");
        }
      }
    }

    this.plans.set(input.planId, { ...plan, status: input.toStatus });
  }

  async createAgentRun(input: {
    planId: string;
    userId: string;
    agentType: AgentType;
  }): Promise<AgentRunRecord> {
    if (this.throwOnCreateAgentRun) {
      const error = this.throwOnCreateAgentRun;
      this.throwOnCreateAgentRun = null;
      throw error;
    }

    this.commandCounts.createAgentRun += 1;
    const id = crypto.randomUUID();
    const run: AgentRunRecord = {
      id,
      agentType: input.agentType,
      planId: input.planId,
      userId: input.userId,
      status: "running",
      state: null,
      error: null,
    };
    this.agentRuns.set(id, run);
    return run;
  }

  async finalizeAgentRun(input: {
    agentRunId: string;
    status: "completed" | "failed";
    error?: string;
  }): Promise<void> {
    if (input.status === "completed" && this.throwOnFinalizeCompleted) {
      const error = this.throwOnFinalizeCompleted;
      this.throwOnFinalizeCompleted = null;
      throw error;
    }
    if (input.status === "failed" && this.throwOnFinalizeFailed) {
      const error = this.throwOnFinalizeFailed;
      this.throwOnFinalizeFailed = null;
      throw error;
    }

    this.commandCounts.finalizeAgentRun += 1;
    const run = this.agentRuns.get(input.agentRunId);
    if (!run) throw new Error(`AgentRun not found: ${input.agentRunId}`);
    this.agentRuns.set(input.agentRunId, {
      ...run,
      status: input.status,
      error: input.error ?? null,
    });
  }

  mergeReadCheckpoint(agentRunId: string, readSet: Readonly<Record<string, number>>): void {
    const run = this.agentRuns.get(agentRunId);
    if (!run) throw new Error(`AgentRun not found: ${agentRunId}`);
    const existing = run.state?.last_read_versions ?? {};
    const merged = { ...existing, ...readSet };
    this.agentRuns.set(agentRunId, {
      ...run,
      state: { last_read_versions: merged },
    });
  }
}
