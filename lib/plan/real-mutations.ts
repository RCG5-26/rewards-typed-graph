import type { MutationEvent } from "./orchestrator-client";
import type { AgentType, MutationLogEntry, PlanResult } from "./types";

/**
 * Project the real `graph_mutations` rows the backend persisted (and exposes
 * over `GET /mutations`) into the console's mutation-log shape. This is the
 * "fully real mutations" path: the op / node / detail / version the dark log
 * renders come from Postgres, not the seed.
 *
 * The one thing the raw rows don't carry is which *visual* typed-graph node to
 * light — their `target_node_id` is a plan/step/dependency UUID, not the
 * `prog:<slug>` ids the canvas lays out. So node-lighting is driven from the
 * derived plan's traversal order: each node-touching real row lights the next
 * hub along the same Chase→Hyatt→Tokyo path the real plan followed. The text is
 * real; the lighting sequence is the deterministic projection.
 */

/** Pull the ordered, de-duplicated visual node ids from the derived log. */
function orderedNodeIds(derived: PlanResult): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of derived.mutations) {
    if (m.nodeId && !seen.has(m.nodeId)) {
      seen.add(m.nodeId);
      ids.push(m.nodeId);
    }
  }
  return ids;
}

interface Mapped {
  op: string;
  agentType: AgentType;
  touchesNode: boolean;
}

/** Map a persisted `mutation_type` onto the console's typed op + agent lane. */
function classify(mutationType: string): Mapped {
  const t = mutationType.toLowerCase();
  if (t.includes("stale")) return { op: "STALE", agentType: "system", touchesNode: true };
  if (t.includes("supersede") || t.includes("replan")) return { op: "REPLAN", agentType: "system", touchesNode: false };
  if (t.includes("transfer")) return { op: "COMMIT", agentType: "redemption_agent", touchesNode: true };
  if (t.includes("dependency")) return { op: "READ", agentType: "wallet_agent", touchesNode: true };
  if (t.includes("step")) return { op: "COMMIT", agentType: "redemption_agent", touchesNode: true };
  if (t.includes("plan")) return { op: "CREATE", agentType: "orchestrator", touchesNode: false };
  return { op: "UPDATE", agentType: "system", touchesNode: true };
}

const lastSeg = (s: string | null | undefined): string =>
  s ? s.split(/[:/]/).pop() ?? "" : "";

/** A concise mono node label from the row's target + `after` payload. */
function nodeLabel(ev: MutationEvent): string {
  const a = ev.after ?? {};
  const table = ev.target_table ?? "graph";
  if (table === "plan_steps") return `plan_steps:${String(a.step_type ?? "step")}`;
  if (table === "plans") return `plans:${String(a.status ?? "current")}`;
  if (table === "state_dependencies") {
    const dep = lastSeg(String(a.target_node_id ?? "")) || String(a.target_table ?? "node");
    return `state_dep:${dep}`;
  }
  const seg = lastSeg(ev.target_node_id);
  return seg ? `${table}:${seg}` : table;
}

function version(ev: MutationEvent): string {
  const a = ev.after ?? {};
  const v = a.version ?? a.observed_version;
  return `v${typeof v === "number" ? v : 1}`;
}

export function realMutationsToLog(
  events: MutationEvent[],
  derived: PlanResult,
  seqStart = 1,
): MutationLogEntry[] {
  const nodeIds = orderedNodeIds(derived);
  let cursor = 0;
  return events.map((ev, i) => {
    const { op, agentType, touchesNode } = classify(ev.mutation_type);
    let nodeId: string | undefined;
    if (touchesNode && nodeIds.length) {
      // Advance through the traversal hubs; clamp on the final (redemption) node.
      nodeId = nodeIds[Math.min(cursor, nodeIds.length - 1)];
      cursor += 1;
    }
    return {
      seq: seqStart + i,
      agentType,
      op,
      node: nodeLabel(ev),
      detail: ev.summary,
      version: version(ev),
      ...(nodeId ? { nodeId } : {}),
    };
  });
}
