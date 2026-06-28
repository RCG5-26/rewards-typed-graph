import type { AgentContext, SpecialistAgentType } from "../agents/contracts";
import type {
  OrchestratorDeps,
  OrchestratorGraphWrite,
  PlanRequest,
  PlanResult,
} from "./contracts";
import { OrchestrationError } from "./contracts";
import { validateDecomposedQuery } from "./decomposition";

type InvocationFailureKind = "agent" | "infrastructure" | "lifecycle_persistence";

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

async function recordCleanupError(
  cleanupErrors: string[],
  label: string,
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    cleanupErrors.push(`${label}: ${errorMessage(err, "unknown error")}`);
  }
}

function withCleanupDetail(
  err: OrchestrationError,
  cleanupErrors: readonly string[],
): OrchestrationError {
  if (cleanupErrors.length === 0) {
    return err;
  }
  return new OrchestrationError(err.kind, err.message, {
    ...err.detail,
    cleanupErrors,
  });
}

function agentRunErrorMessage(primaryError: string, failureKind: InvocationFailureKind): string {
  switch (failureKind) {
    case "agent":
      return primaryError;
    case "lifecycle_persistence":
      return `lifecycle persistence failed: ${primaryError}`;
    case "infrastructure":
      return `orchestration infrastructure failed: ${primaryError}`;
  }
}

async function failInvocation(params: {
  graphWrite: OrchestratorGraphWrite;
  userId: string;
  planId: string;
  planLineageId: string;
  agentRunIds: readonly string[];
  agentRunId?: string;
  primaryError: string;
  failureKind: InvocationFailureKind;
  cleanupErrors: string[];
}): Promise<PlanResult> {
  const runError = agentRunErrorMessage(params.primaryError, params.failureKind);

  if (params.agentRunId) {
    await recordCleanupError(params.cleanupErrors, "finalizeAgentRun(failed)", () =>
      params.graphWrite.finalizeAgentRun({
        agentRunId: params.agentRunId!,
        userId: params.userId,
        status: "failed",
        error: runError,
      }),
    );
  }

  try {
    await params.graphWrite.transitionPlanStatus({ userId: params.userId, planId: params.planId, toStatus: "failed" });
  } catch (err) {
    const transitionError = errorMessage(err, "unknown error");
    params.cleanupErrors.push(`transitionPlanStatus(failed): ${transitionError}`);
    const detail =
      params.cleanupErrors.length > 0 ? `; cleanup errors: ${params.cleanupErrors.join("; ")}` : "";
    throw new Error(`failed to persist plan failure: ${transitionError}${detail}`);
  }

  return {
    planId: params.planId,
    planLineageId: params.planLineageId,
    status: "failed",
    agentRunIds: params.agentRunIds,
  };
}

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async run(request: PlanRequest): Promise<PlanResult> {
    const planLineageId = crypto.randomUUID();
    const plan = await this.deps.graphWrite.createPlan({
      userId: request.userId,
      planLineageId,
      queryText: request.queryText,
    });

    let decomposed;
    try {
      const raw = await this.deps.decomposer.decompose(request.queryText);
      decomposed = validateDecomposedQuery(raw);
    } catch (err) {
      const cleanupErrors: string[] = [];
      await recordCleanupError(cleanupErrors, "transitionPlanStatus(failed)", () =>
        this.deps.graphWrite.transitionPlanStatus({ userId: request.userId, planId: plan.id, toStatus: "failed" }),
      );

      if (err instanceof OrchestrationError) {
        throw withCleanupDetail(err, cleanupErrors);
      }
      throw new OrchestrationError("DecompositionInvalid", "decomposition failed", {
        ...(cleanupErrors.length > 0 ? { cleanupErrors } : {}),
        cause: errorMessage(err, "unknown decomposition error"),
      });
    }

    const agentRunIds: string[] = [];

    for (const invocation of decomposed.invocations) {
      let agentRunId: string | undefined;
      const cleanupErrors: string[] = [];

      try {
        const agentRun = await this.deps.graphWrite.createAgentRun({
          planId: plan.id,
          userId: request.userId,
          agentType: invocation.agentType,
        });
        agentRunId = agentRun.id;
        agentRunIds.push(agentRunId);

        const snapshot = await this.deps.snapshotBuilder.build({
          userId: request.userId,
          planId: plan.id,
        });

        const commit = this.deps.commitFactory.create({
          userId: request.userId,
          planId: plan.id,
          agentRunId: agentRun.id,
          agentType: invocation.agentType,
        });

        try {
          await this.dispatch(invocation.agentType, invocation.operation, {
            planId: plan.id,
            userId: request.userId,
            agentRunId: agentRun.id,
            snapshot,
            commit,
          });
        } catch (agentErr) {
          return failInvocation({
            graphWrite: this.deps.graphWrite,
            userId: request.userId,
            planId: plan.id,
            planLineageId: plan.planLineageId,
            agentRunIds,
            agentRunId,
            primaryError: errorMessage(agentErr, "agent run failed"),
            failureKind: "agent",
            cleanupErrors,
          });
        }

        try {
          await this.deps.graphWrite.finalizeAgentRun({
            agentRunId: agentRun.id,
            userId: request.userId,
            status: "completed",
          });
        } catch (finalizeErr) {
          cleanupErrors.push(
            `finalizeAgentRun(completed): ${errorMessage(finalizeErr, "unknown error")}`,
          );
          return failInvocation({
            graphWrite: this.deps.graphWrite,
            userId: request.userId,
            planId: plan.id,
            planLineageId: plan.planLineageId,
            agentRunIds,
            agentRunId,
            primaryError: errorMessage(finalizeErr, "finalize completed failed"),
            failureKind: "lifecycle_persistence",
            cleanupErrors,
          });
        }
      } catch (infraErr) {
        return failInvocation({
          graphWrite: this.deps.graphWrite,
          userId: request.userId,
          planId: plan.id,
          planLineageId: plan.planLineageId,
          agentRunIds,
          agentRunId,
          primaryError: errorMessage(infraErr, "invocation setup failed"),
          failureKind: "infrastructure",
          cleanupErrors,
        });
      }
    }

    await this.deps.graphWrite.transitionPlanStatus({ userId: request.userId, planId: plan.id, toStatus: "current" });
    return {
      planId: plan.id,
      planLineageId: plan.planLineageId,
      status: "current",
      agentRunIds,
    };
  }

  private async dispatch<K extends SpecialistAgentType>(
    agentType: K,
    operation: AgentContext<K>["operation"],
    base: Omit<AgentContext<K>, "operation">,
  ): Promise<void> {
    switch (agentType) {
      case "wallet_agent":
        return this.deps.agentRegistry.wallet_agent.run({
          ...base,
          operation: operation as AgentContext<"wallet_agent">["operation"],
        });
      case "earning_agent":
        return this.deps.agentRegistry.earning_agent.run({
          ...base,
          operation: operation as AgentContext<"earning_agent">["operation"],
        });
      case "redemption_agent":
        return this.deps.agentRegistry.redemption_agent.run({
          ...base,
          operation: operation as AgentContext<"redemption_agent">["operation"],
        });
      default: {
        const _exhaustive: never = agentType;
        throw new Error(`unknown agent type: ${_exhaustive}`);
      }
    }
  }
}

export type { OrchestratorDeps };
