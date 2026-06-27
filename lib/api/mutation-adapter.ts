/**
 * Maps real Hono graph_mutation events to frontend MutationLogEntry values.
 * Kept separate from adapters.ts to avoid pulling builder.ts (which imports `fs`)
 * into the client bundle — AgentConsole.tsx imports this directly.
 */
import type { AgentType, MutationLogEntry } from "@/lib/plan/types";
import type { RealMutationEvent } from "./types";

export function fromMutationEvent(event: RealMutationEvent, seq: number): MutationLogEntry {
  const node = event.target_table
    ? `${event.target_table}:${(event.target_node_id ?? "").slice(0, 8)}`
    : event.mutation_type;
  return {
    seq,
    agentType: agentForMutationType(event.mutation_type),
    op: opForMutationType(event.mutation_type),
    node,
    detail: event.summary,
    version: "v1",
    nodeId: event.target_node_id ?? undefined,
  };
}

function agentForMutationType(type: string): AgentType {
  switch (type) {
    case "CreatePlan": return "orchestrator";
    case "CreatePlanStep": return "redemption_agent";
    case "RecordStateDependency": return "redemption_agent";
    case "MarkStale": return "system";
    case "TransferPoints": return "system";
    default: return "orchestrator";
  }
}

function opForMutationType(type: string): string {
  switch (type) {
    case "CreatePlan": return "CREATE";
    case "CreatePlanStep": return "COMMIT";
    case "RecordStateDependency": return "COMMIT";
    case "MarkStale": return "STALE";
    case "TransferPoints": return "UPDATE";
    default: return "COMMIT";
  }
}
