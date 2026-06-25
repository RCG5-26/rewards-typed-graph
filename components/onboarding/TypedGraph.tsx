"use client";

import type { GraphNode, PlanGraph } from "@/lib/plan/types";

/**
 * Live typed-graph node view for the console rail. Lays the traversal out by
 * column (source program → dest program → redemption) and lights each node as
 * its mutation streams in; stale nodes/edges flag red on a replan. Pure SVG so
 * it scales into the dark rail and stays token-free of the design system (this
 * is a bespoke dark surface, like the card faces).
 */

const ACCENT = "#86a8ff";
const STALE = "#ec625c";
const VB_W = 440;
const VB_H = 600;
const COL_X = [88, 220, 352];

interface Placed {
  id: string;
  label: string;
  kind: string;
  state: string;
  x: number;
  y: number;
}

export default function TypedGraph({
  graph,
  litNodeIds,
}: {
  graph: PlanGraph;
  litNodeIds: Set<string>;
}) {
  const placed = placeNodes(graph.nodes);

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      {/* edges */}
      {graph.edges.map((e) => {
        const a = placed.get(e.from);
        const b = placed.get(e.to);
        if (!a || !b) return null;
        const lit = litNodeIds.has(e.from) && litNodeIds.has(e.to);
        const stale = e.state === "stale" || e.state === "superseded";
        const midX = (a.x + b.x) / 2;
        const d = `M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}`;
        const color = stale ? STALE : ACCENT;
        return (
          <path
            key={e.id}
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={stale ? 2 : lit ? 2.5 : 1.2}
            strokeOpacity={stale ? 0.9 : lit ? 0.85 : 0.18}
            strokeDasharray={stale ? "5 5" : lit ? "7 6" : undefined}
          >
            {lit && !stale && (
              <animate attributeName="stroke-dashoffset" from="26" to="0" dur="0.9s" repeatCount="indefinite" />
            )}
          </path>
        );
      })}

      {/* nodes */}
      {Array.from(placed.values()).map((n) => {
        const lit = litNodeIds.has(n.id);
        const stale = n.state === "stale";
        const superseded = n.state === "superseded";
        const color = stale ? STALE : ACCENT;
        const isRedemption = n.kind === "redemption";
        const w = 132;
        const h = isRedemption ? 50 : 42;
        return (
          <g key={n.id} opacity={superseded ? 0.32 : 1}>
            {lit && !superseded && (
              <rect
                x={n.x - w / 2 - 4}
                y={n.y - h / 2 - 4}
                width={w + 8}
                height={h + 8}
                rx={14}
                fill="none"
                stroke={color}
                strokeOpacity={0.25}
                strokeWidth={6}
              />
            )}
            <rect
              x={n.x - w / 2}
              y={n.y - h / 2}
              width={w}
              height={h}
              rx={11}
              fill={lit ? "rgba(134,168,255,0.14)" : "rgba(134,168,255,0.05)"}
              stroke={lit || stale ? color : "rgba(134,168,255,0.25)"}
              strokeWidth={1.4}
              strokeDasharray={stale ? "4 3" : undefined}
            />
            <text
              x={n.x}
              y={n.y - (isRedemption ? 4 : 0)}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={lit ? "#dce8ff" : "rgba(220,232,255,0.6)"}
              style={{ fontFamily: "var(--font-mono)", fontSize: isRedemption ? 9.5 : 10.5, fontWeight: 600 }}
            >
              {clamp(n.label, isRedemption ? 22 : 16)}
            </text>
            {isRedemption && (
              <text
                x={n.x}
                y={n.y + 12}
                textAnchor="middle"
                fill={stale ? STALE : "rgba(160,190,255,0.7)"}
                style={{ fontFamily: "var(--font-mono)", fontSize: 8, letterSpacing: "0.08em" }}
              >
                {stale ? "STALE" : "REDEMPTION"}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function clamp(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** Lay nodes out by column (source → dest → redemption), centered per column. */
function placeNodes(nodes: GraphNode[]): Map<string, Placed> {
  const byCol = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const arr = byCol.get(n.col) ?? [];
    arr.push(n);
    byCol.set(n.col, arr);
  }
  const out = new Map<string, Placed>();
  byCol.forEach((group, col) => {
    const x = COL_X[Math.min(col, COL_X.length - 1)];
    const gap = VB_H / (group.length + 1);
    group.forEach((n, i) => {
      out.set(n.id, {
        id: n.id,
        label: n.label,
        kind: n.kind,
        state: n.state ?? "active",
        x,
        y: gap * (i + 1),
      });
    });
  });
  return out;
}
