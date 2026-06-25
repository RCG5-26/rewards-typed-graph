"use client";

import type { GraphNode, PlanGraph } from "@/lib/plan/types";

/**
 * The plan-dependency graph (Hero Moment 1 payoff): plan-step nodes on the left,
 * the state (programs / redemption) they read on the right, wired by
 * `dependency`/`produces` edges. When a balance change invalidates dependents,
 * `staleIds` carries the rippled set and the affected plan nodes + edges light
 * up red — the visible "structural invalidation" the typed graph buys us.
 */

const ACCENT = "#86a8ff";
const STALE = "#ec625c";

const NODE_W = 220;
const NODE_H = 48;
const V_GAP = 24;
const PAD_Y = 26;
const VB_W = 1040;

interface Placed extends GraphNode {
  x: number;
  y: number;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default function PlanDependencyGraph({
  planGraph,
  staleIds,
}: {
  planGraph: PlanGraph | null;
  staleIds: Set<string>;
}) {
  if (!planGraph || planGraph.nodes.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-card bg-surface text-sm text-text-tertiary shadow-raised">
        building plan graph…
      </div>
    );
  }

  const planNodes = planGraph.nodes.filter((n) => n.kind === "plan").sort((a, b) => a.col - b.col);
  const stateNodes = planGraph.nodes.filter((n) => n.kind !== "plan");

  const rowH = NODE_H + V_GAP;
  const colHeight = Math.max(planNodes.length, stateNodes.length) * rowH - V_GAP;
  const vbH = colHeight + PAD_Y * 2;
  const planX = 28;
  const stateX = VB_W - 28 - NODE_W;

  const place = (arr: GraphNode[], x: number): Placed[] => {
    const off = PAD_Y + (colHeight - (arr.length * rowH - V_GAP)) / 2;
    return arr.map((n, i) => ({ ...n, x, y: off + i * rowH }));
  };

  const pos = new Map<string, Placed>();
  for (const p of [...place(stateNodes, stateX), ...place(planNodes, planX)]) pos.set(p.id, p);

  const isStale = (id: string) => staleIds.has(id);

  const edgePath = (fromId: string, toId: string): string | null => {
    const a = pos.get(fromId);
    const b = pos.get(toId);
    if (!a || !b) return null;
    const ay = a.y + NODE_H / 2;
    const by = b.y + NODE_H / 2;
    if (a.kind === "plan" && b.kind !== "plan") {
      // plan (left) → state (right)
      const sx = a.x + NODE_W;
      const tx = b.x;
      const mx = (sx + tx) / 2;
      return `M ${sx} ${ay} C ${mx} ${ay}, ${mx} ${by}, ${tx} ${by}`;
    }
    if (a.kind === "plan" && b.kind === "plan") {
      // plan → plan: bow out to the left
      const bow = Math.min(a.x, b.x) - 44;
      return `M ${a.x} ${ay} C ${bow} ${ay}, ${bow} ${by}, ${b.x} ${by}`;
    }
    return `M ${a.x + NODE_W / 2} ${ay} L ${b.x + NODE_W / 2} ${by}`;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-surface p-5 shadow-raised">
      <div className="mb-1 flex items-baseline justify-between">
        <div className="font-display text-sm font-semibold uppercase tracking-wide text-text-primary">
          plan dependency graph
        </div>
        <div className="font-mono text-2xs text-text-tertiary">
          plan steps → the state they depend on · a balance change ripples stale (red)
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <svg viewBox={`0 0 ${VB_W} ${vbH}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <marker id="dep-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill={ACCENT} opacity="0.55" />
            </marker>
            <marker id="dep-arrow-stale" markerWidth="9" markerHeight="9" refX="7.5" refY="4.5" orient="auto">
              <path d="M0,0 L9,4.5 L0,9 z" fill={STALE} />
            </marker>
          </defs>

          {planGraph.edges.map((e) => {
            const d = edgePath(e.from, e.to);
            if (!d) return null;
            const stale = isStale(e.from) && isStale(e.to);
            const dashed = e.kind !== "produces" && !stale;
            return (
              <path
                key={e.id}
                d={d}
                fill="none"
                stroke={stale ? STALE : ACCENT}
                strokeOpacity={stale ? 0.95 : 0.4}
                strokeWidth={stale ? 2.4 : 1.4}
                strokeDasharray={dashed ? "5 5" : "0"}
                markerEnd={`url(#${stale ? "dep-arrow-stale" : "dep-arrow"})`}
              />
            );
          })}

          {[...place(stateNodes, stateX), ...place(planNodes, planX)].map((n) => {
            const stale = isStale(n.id);
            const plan = n.kind === "plan";
            const redemption = n.kind === "redemption";
            const stroke = stale ? STALE : plan || redemption ? ACCENT : "#33415e";
            const fill = stale
              ? "rgba(236,98,92,0.14)"
              : plan
                ? "rgba(134,168,255,0.10)"
                : redemption
                  ? "rgba(134,168,255,0.07)"
                  : "rgba(20,28,48,0.05)";
            const tag = plan ? `step ${n.col}` : n.kind;
            return (
              <g key={n.id} transform={`translate(${n.x} ${n.y})`}>
                <rect width={NODE_W} height={NODE_H} rx="10" fill={fill} stroke={stroke} strokeWidth={stale ? 2 : 1.2} />
                <text
                  x="13"
                  y="19"
                  fontFamily="var(--font-mono), ui-monospace, monospace"
                  fontSize="9"
                  letterSpacing="0.08em"
                  fill={stale ? STALE : "#7c8aa3"}
                >
                  {(stale ? `${tag} · stale` : tag).toUpperCase()}
                </text>
                <text x="13" y="36" fontSize="13" fontWeight="600" fill={stale ? "#b9332e" : "#1a1f2e"}>
                  {clip(n.label, plan ? 30 : 24)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
