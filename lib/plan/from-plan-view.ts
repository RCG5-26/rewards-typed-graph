import type { PlanView, PlanStepView } from "./orchestrator-client";
import type { AgentType, PlanResult, PlanStatus, PlanStep, StepStatus } from "./types";

/**
 * Project the authoritative plan from the real orchestrator (`PlanView`:
 * identity, lifecycle, revision, persisted steps) onto the console's
 * `PlanResult`, reusing a deterministic `derived` projection for the parts the
 * `PlanView` contract does not (yet) carry — the typed-graph topology, the
 * mutation log, the route summary, and the estimated value.
 *
 * So: the plan id/lineage/status/revision and the *steps the user reads* come
 * from Postgres via the real backend; the typed-graph visual + mutation stream
 * remain the seed-derived presentation until the backend exposes the
 * `graph_mutations` log over SSE. For the single deterministic demo seed the two
 * agree on the same Chase→Hyatt→Tokyo path, so they stay coherent.
 */

/** Infer the rendering agent lane from the persisted step's typed operation. */
function agentTypeForStep(type: string): AgentType {
  const t = type.toLowerCase();
  if (t.includes("decompose") || t.includes("orchestr")) return "orchestrator";
  if (t.includes("wallet") || t.includes("balance") || t.includes("assess")) return "wallet_agent";
  if (t.includes("earn")) return "earning_agent";
  if (t.includes("redempt") || t.includes("transfer") || t.includes("traverse") || t.includes("award")) {
    return "redemption_agent";
  }
  return "system";
}

function mapStep(s: PlanStepView): PlanStep {
  return {
    order: s.order,
    agentType: agentTypeForStep(s.type),
    type: s.type,
    title: s.summary,
    reasoning: s.reasoning,
    status: s.status as StepStatus,
    deps: s.dependsOn,
  };
}

export function planResultFromView(view: PlanView, derived: PlanResult): PlanResult {
  return {
    ...derived,
    planId: view.planId,
    planLineageId: view.planLineageId,
    status: view.status as PlanStatus,
    revision: view.revisionNumber,
    queryText: view.query,
    steps: view.steps.length ? view.steps.map(mapStep) : derived.steps,
  };
}
