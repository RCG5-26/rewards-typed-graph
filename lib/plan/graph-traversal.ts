import type { GraphNodeKind, PlanGraph } from "./types";

export interface TraversalHub {
  id: string;
  label: string;
  kind: GraphNodeKind;
  stale: boolean;
  x: number;
  depth: number;
}

/** A node that hangs off a main-path hub (e.g. a backup redemption). */
export interface BranchHub extends TraversalHub {
  /** The main-path hub this branch connects from. */
  parentId: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
    // Keep the FIRST edge out of each node as the main path. The graph lists a
    // program's primary (winner) redemption before its backups, so first-wins
    // puts the recommended award on the flight path; the rest become branches.
    if (!next.has(e.from)) next.set(e.from, e.to);
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
      kind: node.kind,
      stale: node.state === "stale",
      x: pos[i][0],
      depth: pos[i][1],
    };
  });
}

/**
 * Secondary nodes that branch off the main path — e.g. a backup redemption that
 * shares a program hub with the recommended award. Each is positioned relative
 * to its parent hub so the canvas can draw a short connector + bead without
 * disturbing the linear flight path the plane flies.
 */
export function buildBranches(
  graph: PlanGraph,
  mainPath: TraversalHub[],
): BranchHub[] {
  if (!graph.edges.length || mainPath.length === 0) return [];
  const activeEdges = graph.edges.filter(
    (e) => e.state !== "stale" && e.state !== "superseded",
  );
  const posById = new Map(mainPath.map((h) => [h.id, h]));
  const onMainPath = new Set(mainPath.map((h) => h.id));
  // The main successor of each hub is already drawn on the flight path.
  const mainNext = new Map<string, string>();
  for (let i = 0; i < mainPath.length - 1; i++) {
    mainNext.set(mainPath[i].id, mainPath[i + 1].id);
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const branches: BranchHub[] = [];
  const seen = new Set<string>();
  let idx = 0;
  for (const e of activeEdges) {
    const parent = posById.get(e.from);
    if (!parent) continue; // branch must hang off a node already on the path
    if (mainNext.get(e.from) === e.to) continue; // that edge is the main path
    if (onMainPath.has(e.to) || seen.has(e.to)) continue;
    const node = byId.get(e.to);
    if (!node) continue;
    seen.add(e.to);
    branches.push({
      id: e.to,
      label: node.label,
      kind: node.kind,
      stale: node.state === "stale",
      x: clamp(parent.x + 0.4 + idx * 0.12, -0.72, 0.72),
      depth: clamp(parent.depth + 0.26 + idx * 0.14, 0.06, 0.97),
      parentId: e.from,
    });
    idx++;
  }
  return branches;
}
