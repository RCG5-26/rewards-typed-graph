/**
 * Live graph-orchestrator adapter. Drives the real `PlanService.createPlan`
 * (TypeScript orchestrator → PostgreSQL snapshot → wallet + redemption
 * specialists → controlled writes → projected PlanView), then normalizes the
 * persisted PlanView. This adapter may persist a Plan (that is the architecture's
 * nature); failures are returned as a `failed` result, never thrown.
 *
 * The `PlanService` is injected so tests can run without a database.
 */

import { CANONICAL_GRAPH_USER_ID } from "../canonical-wallet";
import type { ArchitectureComparisonResult } from "../types";
import type { PlanView } from "../../plans/types";
import { normalizeGraphPlan } from "./graph-normalizer";
import { type AdapterInput, resolveQuery } from "./types";

/**
 * The single capability this adapter needs from a plan service. Narrowed (ISP)
 * so the real `PlanService` satisfies it structurally and tests can stub just
 * `createPlan` without implementing the whole interface.
 */
export interface GraphPlanRunner {
  createPlan(userId: string, query: string): Promise<PlanView>;
}

export interface GraphAdapterOptions extends AdapterInput {
  service: GraphPlanRunner;
  userId?: string;
}

export async function runGraphOrchestrator(
  options: GraphAdapterOptions,
): Promise<ArchitectureComparisonResult> {
  const { facts, service } = options;
  const query = resolveQuery(options);
  const userId = options.userId ?? CANONICAL_GRAPH_USER_ID;
  const startedAt = Date.now();

  const base = {
    variant: "live-graph-orchestrator",
    walletId: facts.walletId,
    walletVersion: facts.version,
    query,
  } as const;

  try {
    const view = await service.createPlan(userId, query);
    const latencyMs = Date.now() - startedAt;
    const plan = normalizeGraphPlan(view, facts);

    return {
      ...base,
      status: "succeeded",
      plan,
      metrics: { latencyMs },
      evidence: buildEvidence(view, facts.awardOptions.map((a) => a.awardSlug)),
    };
  } catch (error) {
    return {
      ...base,
      status: "failed",
      metrics: { latencyMs: Date.now() - startedAt },
      error: {
        category: "graph_execution_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function buildEvidence(
  view: PlanView,
  availableAwardIds: string[],
): ArchitectureComparisonResult["evidence"] {
  const citedAwardIds = view.graph.nodes
    .filter((n) => n.kind === "redemption")
    .map((n) => n.slug);
  const dependencyCount = view.steps.reduce((sum, step) => sum + step.dependencies.length, 0);

  return {
    agentTypes: ["wallet-specialist", "redemption-specialist"],
    planId: view.planId,
    lineageId: view.planLineageId,
    revisionNumber: view.revisionNumber,
    dependencyCount,
    citedAwardIds,
    availableAwardIds,
  };
}
