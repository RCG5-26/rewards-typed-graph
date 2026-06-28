import type { AgentContext, SpecialistAgentType } from "../agents/contracts";
import type {
  OrchestratorDeps,
  OrchestratorGraphWrite,
  PlanRequest,
  PlanResult,
  RevisionResult,
  RevisionSpec,
} from "./contracts";
import { OrchestrationError } from "./contracts";
import { validateDecomposedQuery } from "./decomposition";

/** Internal success/failure outcome shared by initial and revision runs. */
type ExecuteOutcome =
  | { ok: true; planId: string; planLineageId: string; agentRunIds: readonly string[] }
  | { ok: false; failure: PlanResult };

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

  /** Initial plan: mint a fresh lineage at revision 1 and promote to current. */
  async run(request: PlanRequest): Promise<PlanResult> {
    const outcome = await this.execute(request, null);
    if (!outcome.ok) {
      return outcome.failure;
    }
    await this.deps.graphWrite.transitionPlanStatus({
      userId: request.userId,
      planId: outcome.planId,
      toStatus: "current",
    });
    return {
      planId: outcome.planId,
      planLineageId: outcome.planLineageId,
      status: "current",
      agentRunIds: outcome.agentRunIds,
    };
  }

  /**
   * Replan re-entry: build a new revision IN AN EXISTING lineage. On success the
   * revision is left 'generating' with 'proposed' steps — the caller's
   * replan-job promotion (`promote_replan_job_success`) is the single boundary
   * that flips it to 'current', supersedes the prior revision, and promotes its
   * steps. Promoting here would violate that precondition and risk two currents.
   */
  async runRevision(request: PlanRequest, revision: RevisionSpec): Promise<RevisionResult> {
    const outcome = await this.execute(request, revision);
    if (!outcome.ok) {
      return {
        planId: outcome.failure.planId,
        planLineageId: outcome.failure.planLineageId,
        revisionNumber: revision.revisionNumber,
        status: "failed",
        agentRunIds: outcome.failure.agentRunIds,
      };
    }
    return {
      planId: outcome.planId,
      planLineageId: outcome.planLineageId,
      revisionNumber: revision.revisionNumber,
      status: "generating",
      agentRunIds: outcome.agentRunIds,
    };
  }

  private async execute(
    request: PlanRequest,
    revision: RevisionSpec | null,
  ): Promise<ExecuteOutcome> {
    const planLineageId = revision?.planLineageId ?? crypto.randomUUID();
    const plan = await this.deps.graphWrite.createPlan({
      userId: request.userId,
      planLineageId,
      queryText: request.queryText,
      ...(revision
        ? { revisionNumber: revision.revisionNumber, supersedesPlanId: revision.supersedesPlanId }
        : {}),
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
          return {
            ok: false,
            failure: await failInvocation({
              graphWrite: this.deps.graphWrite,
              userId: request.userId,
              planId: plan.id,
              planLineageId: plan.planLineageId,
              agentRunIds,
              agentRunId,
              primaryError: errorMessage(agentErr, "agent run failed"),
              failureKind: "agent",
              cleanupErrors,
            }),
          };
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
          return {
            ok: false,
            failure: await failInvocation({
              graphWrite: this.deps.graphWrite,
              userId: request.userId,
              planId: plan.id,
              planLineageId: plan.planLineageId,
              agentRunIds,
              agentRunId,
              primaryError: errorMessage(finalizeErr, "finalize completed failed"),
              failureKind: "lifecycle_persistence",
              cleanupErrors,
            }),
          };
        }
      } catch (infraErr) {
        return {
          ok: false,
          failure: await failInvocation({
            graphWrite: this.deps.graphWrite,
            userId: request.userId,
            planId: plan.id,
            planLineageId: plan.planLineageId,
            agentRunIds,
            agentRunId,
            primaryError: errorMessage(infraErr, "invocation setup failed"),
            failureKind: "infrastructure",
            cleanupErrors,
          }),
        };
      }
    }

    return { ok: true, planId: plan.id, planLineageId: plan.planLineageId, agentRunIds };
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
