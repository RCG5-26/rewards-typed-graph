/**
 * Maps the **real** live `graph_mutations` stream to an `AgentActivityTrace`.
 *
 * Source: `/api/mutations/stream` → Hono `/mutations/stream` (apps/api/src/
 * mutations/events.ts). These are real committed DB rows, not fixtures.
 *
 * Honesty boundary — this adapter populates ONLY what the event contract carries:
 *  - specialist  → inferred from `mutation_type` (the legacy runtime leaves
 *                  `agent_run_id`/agent_type null; same heuristic as
 *                  `mutation-adapter.ts`). Labeled inferred until the orchestrator
 *                  (M4/M9) populates real `agent_runs`.
 *  - operation   → `mutation_type`.
 *  - status      → always `succeeded` — a streamed row is a committed mutation.
 *  - commit      → `{committed, mutationTxnId}` when `mutation_txn_id` is present.
 *  - revision    → inferred by CreatePlan order within the lineage (1st = rev 1…).
 *
 * Fields the contract does NOT carry are left `undefined` — never fabricated:
 *  - snapshotVersion, validation, startedAt/endedAt (need the orchestrator
 *    backend: M4 `agent_runs` + M9 observability, currently unmounted).
 */

import type {
  ActivityEntry,
  AgentActivityTrace,
  PlanLifecycleEntry,
  SpecialistRunEntry,
} from "@/lib/plan/activity";
import type { AgentType } from "@/lib/plan/types";
import type { RealMutationEvent } from "./types";

/** Inferred specialist for a mutation type (no agent_run_id on legacy rows). */
function specialistForMutation(type: string): AgentType {
  switch (type) {
    case "UpdateUserBalance":
      return "wallet_agent";
    case "CreatePlanStep":
    case "RecordStateDependency":
      return "redemption_agent";
    case "CreatePlan":
    case "MarkStale":
      return "orchestrator";
    case "TransferPoints":
      return "system";
    default:
      return "orchestrator";
  }
}

/** Human label for the typed operation (kept close to the mutation_type). */
function operationLabel(type: string): string {
  switch (type) {
    case "UpdateUserBalance":
      return "Update balance";
    case "CreatePlanStep":
      return "Create plan step";
    case "RecordStateDependency":
      return "Record dependency";
    case "TransferPoints":
      return "Transfer points";
    default:
      return type;
  }
}

/** mutation_types that represent a Plan-revision lifecycle transition, not a specialist write. */
const LIFECYCLE_TYPES = new Set(["CreatePlan", "MarkStale", "SupersedePlan", "PromotePlan"]);

function lifecycleTransition(type: string): PlanLifecycleEntry["transition"] {
  switch (type) {
    case "CreatePlan":
      return "committed";
    case "MarkStale":
      return "stale";
    case "SupersedePlan":
      return "superseded";
    case "PromotePlan":
      return "promoted";
    default:
      return "committed";
  }
}

function specialistEntry(event: RealMutationEvent): SpecialistRunEntry {
  const entry: SpecialistRunEntry = {
    kind: "specialist_run",
    // event_id is unique per mutation row, so it is the stable React key even
    // when one agent_run_id emits several mutations (which would collide).
    runId: event.event_id,
    specialist: specialistForMutation(event.mutation_type),
    operation: event.mutation_type,
    operationLabel: operationLabel(event.mutation_type),
    status: "succeeded",
    detail: event.summary,
  };
  if (event.committed_at) {
    return event.mutation_txn_id
      ? {
          ...entry,
          endedAt: event.committed_at,
          commit: { result: "committed", mutationTxnId: event.mutation_txn_id },
        }
      : { ...entry, endedAt: event.committed_at };
  }
  return event.mutation_txn_id
    ? { ...entry, commit: { result: "committed", mutationTxnId: event.mutation_txn_id } }
    : entry;
}

/**
 * Build a trace from real mutation events (oldest → newest).
 * Revision numbers are inferred from the order of CreatePlan rows in the lineage.
 */
export function mutationEventsToActivityTrace(events: readonly RealMutationEvent[]): AgentActivityTrace {
  const planLineageId = events.find((e) => e.plan_lineage_id)?.plan_lineage_id ?? "";
  let createdPlans = 0;
  // Track which revision each plan_id maps to, so MarkStale/supersede can reference it.
  const revisionByPlanId = new Map<string, number>();

  const entries: ActivityEntry[] = events.map((event) => {
    if (LIFECYCLE_TYPES.has(event.mutation_type)) {
      let revision: number;
      if (event.mutation_type === "CreatePlan") {
        revision = ++createdPlans;
        if (event.plan_id) revisionByPlanId.set(event.plan_id, revision);
      } else {
        revision = (event.plan_id && revisionByPlanId.get(event.plan_id)) || createdPlans || 1;
      }
      const lifecycle: PlanLifecycleEntry = {
        kind: "plan_lifecycle",
        revision,
        transition: lifecycleTransition(event.mutation_type),
        status: "succeeded",
        reason: event.summary,
      };
      return lifecycle;
    }
    return specialistEntry(event);
  });

  return { planLineageId, entries };
}
