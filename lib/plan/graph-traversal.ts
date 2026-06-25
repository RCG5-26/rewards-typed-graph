import type { PlanGraph } from "./types";

export interface TraversalHub {
  id: string;
  label: string;
  stale: boolean;
  x: number;
  depth: number;
}

// Path layouts by hub count — x ∈ [-0.7, 0.7], depth 0 (near) → 1 (far).
const LAYOUTS: Record<number, [number, number][]> = {
  2: [
    [-0.46, 0.14],
    [0.44, 0.54],
  ],
  3: [
    [-0.52, 0.12],
    [0.1, 0.5],
    [0.52, 0.3],
  ],
  4: [
    [-0.54, 0.11],
    [-0.14, 0.46],
    [0.3, 0.26],
    [0.56, 0.6],
  ],
  5: [
    [-0.58, 0.1],
    [-0.26, 0.42],
    [0.06, 0.24],
    [0.36, 0.54],
    [0.6, 0.34],
  ],
};

/**
 * Ordered active-edge traversal chain → layout hubs for the typed-graph view.
 * Stale/superseded edges are excluded so a replan cannot truncate the path.
 */
export function buildTraversalChain(graph: PlanGraph): TraversalHub[] {
  if (!graph.edges.length) return [];
  const activeEdges = graph.edges.filter(
    (e) => e.state !== "stale" && e.state !== "superseded",
  );
  const next = new Map<string, string>();
  const tos = new Set<string>();
  for (const e of activeEdges) {
    next.set(e.from, e.to);
    tos.add(e.to);
  }
  let start: string | undefined;
  for (const e of activeEdges) {
    if (!tos.has(e.from)) {
      start = e.from;
      break;
    }
  }
  start ??= activeEdges[0]?.from;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const ids: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = start;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (byId.has(cur)) ids.push(cur);
    cur = next.get(cur);
  }
  const n = Math.min(Math.max(ids.length, 2), 5);
  const pos = LAYOUTS[n] ?? LAYOUTS[3];
  return ids.slice(0, n).map((id, i) => {
    const node = byId.get(id)!;
    return {
      id,
      label: node.label,
      stale: node.state === "stale",
      x: pos[i][0],
      depth: pos[i][1],
    };
  });
}
