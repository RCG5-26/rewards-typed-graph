"use client";

import { useEffect, useRef, useState } from "react";

import { AGENT_META, opColor } from "@/lib/plan/presentation";
import type {
  Invalidation,
  MutationLogEntry,
  PlanGraph,
  PlanResult,
  PlanStatus,
  PlanStep,
  StepStatus,
} from "@/lib/plan/types";
import BenchmarkView from "./BenchmarkView";
import ContrastView from "./ContrastView";
import TypedGraph from "./TypedGraph";

type ConsoleView = "plan" | "baselines" | "benchmark";
const VIEWS: { id: ConsoleView; label: string }[] = [
  { id: "plan", label: "plan" },
  { id: "baselines", label: "baselines" },
  { id: "benchmark", label: "benchmark" },
];

/**
 * Agent console — stream-driven. Subscribes to `/api/plan/stream` (SSE) and
 * renders the typed mutations as they arrive: the per-step agent plan, the live
 * graph-mutation log, and the typed-graph node view that lights up node by
 * node. The "balance changed" control fires the replan stream (Hero Moment 1):
 * a transfer edge goes stale, the plan revision is superseded, and a new
 * current revision streams in.
 */

const STATUS_VARS: Record<StepStatus, { color: string; bg: string }> = {
  proposed: { color: "var(--status-proposed)", bg: "var(--status-proposed-bg)" },
  current: { color: "var(--status-current)", bg: "var(--status-current-bg)" },
  stale: { color: "var(--status-stale)", bg: "var(--status-stale-bg)" },
  superseded: { color: "var(--status-superseded)", bg: "var(--status-superseded-bg)" },
};

type Meta = Omit<PlanResult, "mutations">;

function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** Merge a streamed revision's graph into the live map (never deletes). */
function mergeGraph(prev: PlanGraph, next: PlanGraph): PlanGraph {
  const nodes = new Map(prev.nodes.map((n) => [n.id, n]));
  for (const n of next.nodes) nodes.set(n.id, n);
  const edges = new Map(prev.edges.map((e) => [e.id, e]));
  for (const e of next.edges) edges.set(e.id, e);
  return { nodes: Array.from(nodes.values()), edges: Array.from(edges.values()) };
}

function applyInvalidation(g: PlanGraph, inv: Invalidation): PlanGraph {
  return {
    nodes: g.nodes.map((n) =>
      inv.staleNodeIds.includes(n.id) ? { ...n, state: "stale" } : n,
    ),
    edges: g.edges.map((e) =>
      e.id === inv.staleEdgeId ? { ...e, state: "stale" } : e,
    ),
  };
}

export default function AgentConsole({
  queryText,
  selectedCardIds,
  onRestart,
}: {
  queryText: string;
  selectedCardIds: string[];
  onRestart: () => void;
}) {
  const [steps, setSteps] = useState<PlanStep[]>([]);
  const [mutations, setMutations] = useState<MutationLogEntry[]>([]);
  const [graph, setGraph] = useState<PlanGraph>({ nodes: [], edges: [] });
  const [lit, setLit] = useState<Set<string>>(new Set());
  const [liveNodes, setLiveNodes] = useState(0);
  const [route, setRoute] = useState("");
  const [goalLabel, setGoalLabel] = useState("");
  const [valueCents, setValueCents] = useState(0);
  const [prevValueCents, setPrevValueCents] = useState<number | null>(null);
  const [revision, setRevision] = useState(1);
  const [status, setStatus] = useState<"streaming" | "current" | "replanning" | "failed">("streaming");
  const [replanned, setReplanned] = useState(false);
  const [view, setView] = useState<ConsoleView>("plan");

  const esRef = useRef<EventSource | null>(null);
  const doneRef = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);

  function openStream(replan: boolean) {
    esRef.current?.close();
    doneRef.current = false;
    const valueAtStart = valueCents;
    const params = new URLSearchParams({ q: queryText });
    if (selectedCardIds.length) params.set("cards", selectedCardIds.join(","));
    if (replan) params.set("replan", "1");
    const es = new EventSource(`/api/plan/stream?${params.toString()}`);
    esRef.current = es;

    es.addEventListener("invalidation", (ev) => {
      const inv = JSON.parse((ev as MessageEvent).data) as Invalidation;
      setStatus("replanning");
      setGraph((g) => applyInvalidation(g, inv));
      setMutations((m) => [...m, inv.mutation]);
      if (inv.mutation.nodeId) setLit((s) => new Set(s).add(inv.mutation.nodeId as string));
    });

    es.addEventListener("meta", (ev) => {
      const meta = JSON.parse((ev as MessageEvent).data) as Meta;
      setSteps(meta.steps);
      setGraph((g) => mergeGraph(g, meta.graph));
      setLiveNodes(meta.liveNodes);
      setRoute(meta.route);
      setGoalLabel(meta.goalLabel);
      setRevision(meta.revision);
    });

    es.addEventListener("mutation", (ev) => {
      const row = JSON.parse((ev as MessageEvent).data) as MutationLogEntry;
      setMutations((m) => [...m, row]);
      if (row.nodeId) setLit((s) => new Set(s).add(row.nodeId as string));
    });

    es.addEventListener("done", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as {
        status: PlanStatus;
        planValueCents: number;
        route: string;
      };
      if (replan) setPrevValueCents(valueAtStart);
      setValueCents(d.planValueCents);
      setRoute(d.route);
      setStatus(d.status === "failed" ? "failed" : "current");
      doneRef.current = true;
      es.close();
    });

    es.addEventListener("error", () => {
      if (!doneRef.current) setStatus("failed");
      es.close();
    });
  }

  // Open the initial stream once.
  useEffect(() => {
    openStream(false);
    return () => esRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the mutation log scrolled to the newest row.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [mutations]);

  const failed = status === "failed";

  function triggerReplan() {
    if (replanned) return;
    setReplanned(true);
    openStream(true);
  }

  return (
    <div className="absolute inset-0 z-[2] flex">
      {/* ── left: typed-graph traversal rail ── */}
      <div
        className="relative flex w-2/5 flex-none flex-col justify-between overflow-hidden p-7"
        style={{ background: "#060912", boxShadow: "inset -1px 0 0 rgba(125,166,255,0.14)" }}
      >
        <TypedGraph graph={graph} litNodeIds={lit} />

        <div className="pointer-events-none relative z-10">
          <div className="font-display text-2xs font-semibold uppercase tracking-widest text-[#a0beff]/85">
            typed-graph traversal
          </div>
          <div className="mt-1.5 max-w-[260px] font-mono text-2xs leading-relaxed text-white/55">
            {route || "resolving…"}
          </div>
        </div>

        <div className="pointer-events-none relative z-10">
          <div className="font-display text-2xs font-semibold uppercase tracking-wide text-[#a0beff]/70">
            plan value · est.
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-4xl font-semibold leading-none text-white">
              {dollars(valueCents)}
            </span>
            {prevValueCents !== null && prevValueCents !== valueCents && (
              <span className="font-mono text-xs text-[#ec625c]">
                was {dollars(prevValueCents)}
              </span>
            )}
          </div>
        </div>

        <div
          className="absolute right-6 top-6 z-10 flex items-center gap-2 rounded-full px-3 py-1.5 backdrop-blur"
          style={{ background: "rgba(134,168,255,0.14)", border: "1px solid rgba(134,168,255,0.32)" }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "oklch(78% 0.14 248)", boxShadow: "0 0 10px oklch(78% 0.14 248)" }} />
          <span className="text-2xs font-semibold text-[#dce8ff]/90">{liveNodes} nodes live</span>
        </div>
      </div>

      {/* ── right: header + plan + mutation log ── */}
      <div className="flex min-w-0 flex-1 flex-col p-7">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div className="font-display text-xl font-semibold uppercase leading-none tracking-snug text-text-primary">
              agent console
            </div>
            <PhaseChip status={status} goalLabel={goalLabel} revision={revision} />
          </div>
          <div className="flex items-center gap-2">
            {/* view tabs */}
            <div className="flex rounded-full bg-surface-subtle p-1">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setView(v.id)}
                  className="rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-base"
                  style={{
                    background: view === v.id ? "var(--color-surface)" : "transparent",
                    color: view === v.id ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                    boxShadow: view === v.id ? "var(--shadow-xs)" : "none",
                  }}
                >
                  {v.label}
                </button>
              ))}
            </div>
            {view === "plan" && (
              <button
                type="button"
                onClick={triggerReplan}
                disabled={replanned || status !== "current"}
                className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: "var(--status-stale-bg)", color: "var(--status-stale)" }}
              >
                ⚡ balance changed · replan
              </button>
            )}
            <button
              type="button"
              onClick={onRestart}
              className="flex items-center gap-1.5 rounded-full border border-DEFAULT bg-surface px-3.5 py-2 text-xs font-medium text-text-secondary shadow-xs"
            >
              ↺ reset
            </button>
          </div>
        </div>

        {view === "baselines" ? (
          <ContrastView planValueCents={valueCents} />
        ) : view === "benchmark" ? (
          <BenchmarkView />
        ) : failed && steps.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-error-fg">
            Could not build a plan. Try resetting.
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 gap-3">
            {/* per-step agent plan */}
            <div className="flex min-h-0 flex-[1.18] flex-col overflow-hidden rounded-card bg-surface shadow-raised">
              <div className="border-b border-subtle px-5 pb-2.5 pt-4">
                <div className="font-display text-xs font-semibold uppercase tracking-wide text-text-primary">
                  agent plan
                </div>
                <div className="mt-0.5 text-xs text-text-tertiary">
                  multi-step · per-step reasoning{revision > 1 ? ` · revision ${revision}` : ""}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-2">
                {steps.map((s) => {
                  const meta = AGENT_META[s.agentType];
                  const sv = STATUS_VARS[s.status];
                  return (
                    <div key={`${revision}-${s.order}`} className="flex gap-3 border-b border-subtle py-3 last:border-0">
                      <div
                        className="flex h-7 w-7 flex-none items-center justify-center rounded-lg font-mono text-2xs font-semibold"
                        style={{ background: `${meta.color}14`, color: meta.color, border: `1px solid ${meta.color}33` }}
                      >
                        {meta.short}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-text-primary">{s.title}</span>
                          <span className="rounded font-mono text-2xs font-medium" style={{ color: sv.color, background: sv.bg, padding: "2px 6px" }}>
                            {s.status}
                          </span>
                        </div>
                        <div className="mt-1.5 text-2xs font-semibold uppercase tracking-wide" style={{ color: meta.color }}>
                          {meta.name} · {s.type}
                        </div>
                        <div className="mt-1.5 text-xs leading-relaxed text-text-secondary">{s.reasoning}</div>
                        {s.deps.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {s.deps.map((d) => (
                              <span key={d} className="inline-flex items-center gap-1 rounded font-mono text-2xs text-[#8a93a6]" style={{ background: "rgba(20,24,40,0.04)", border: "1px solid rgba(20,24,40,0.06)", padding: "2px 7px" }}>
                                ⊿ {d}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* live mutation log (dark) */}
            <div
              className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card"
              style={{ background: "linear-gradient(180deg,#0c1322,#080d18)", boxShadow: "0 4px 22px rgba(10,14,30,0.25), inset 0 0 0 1px rgba(125,166,255,0.10)" }}
            >
              <div className="flex items-center justify-between border-b px-4 pb-3 pt-4" style={{ borderColor: "rgba(125,166,255,0.12)" }}>
                <div>
                  <div className="font-display text-xs font-semibold uppercase tracking-wide text-[#dce8ff]/90">graph mutations</div>
                  <div className="mt-0.5 text-2xs text-[#a0beff]/55">typed · schema-validated · streaming</div>
                </div>
                <span className="rounded-md px-2 py-1 font-mono text-2xs text-[#a0beff]/80" style={{ background: "rgba(134,168,255,0.12)" }}>
                  {mutations.length} ops
                </span>
              </div>
              <div ref={logRef} className="flex-1 overflow-y-auto px-3 py-2">
                {mutations.map((m) => {
                  const meta = AGENT_META[m.agentType];
                  return (
                    <div key={m.seq} className="mb-1 flex gap-2 rounded-lg px-2 py-1.5" style={{ background: "rgba(134,168,255,0.04)", animation: "gp-row-in 0.3s ease" }}>
                      <span className="w-[18px] flex-none pt-0.5 text-right font-mono text-2xs text-[#a0beff]/40">{m.seq}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 flex-none rounded-sm" style={{ background: meta.color }} />
                          <span className="font-mono text-2xs font-semibold" style={{ color: meta.color }}>{meta.short}</span>
                          <span className="rounded font-mono text-2xs font-semibold" style={{ color: opColor(m.op), background: `${opColor(m.op)}1f`, padding: "1px 5px" }}>{m.op}</span>
                          <span className="truncate font-mono text-2xs text-[#dce8ff]/85">{m.node}</span>
                        </div>
                        <div className="mt-0.5 pl-3 font-mono text-2xs leading-relaxed text-[#bed2fa]/70">{m.detail}</div>
                      </div>
                      <span className="flex-none pt-0.5 font-mono text-[#7da6ff]/70" style={{ fontSize: "8px" }}>{m.version}</span>
                    </div>
                  );
                })}
                {status === "streaming" || status === "replanning" ? (
                  <div className="flex items-center gap-2 px-2 py-2">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: "#86a8ff" }} />
                    <span className="font-mono text-2xs text-[#a0beff]/60">
                      {status === "replanning" ? "re-planning…" : "agents committing…"}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="border-t px-4 py-2 text-center text-2xs text-[#a0beff]/50" style={{ borderColor: "rgba(125,166,255,0.12)" }}>
                coordination is state, not messages
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PhaseChip({
  status,
  goalLabel,
  revision,
}: {
  status: "streaming" | "current" | "replanning" | "failed";
  goalLabel: string;
  revision: number;
}) {
  const map = {
    streaming: { color: "var(--status-generating)", bg: "var(--status-generating-bg)", text: "generating plan…" },
    replanning: { color: "var(--status-stale)", bg: "var(--status-stale-bg)", text: "invalidated · re-planning" },
    current: { color: "var(--status-current)", bg: "var(--status-current-bg)", text: `plan current${revision > 1 ? ` · r${revision}` : ""} · ${goalLabel}` },
    failed: { color: "var(--status-failed)", bg: "var(--status-failed-bg)", text: "no plan · failed" },
  }[status];
  return (
    <div className="flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: map.bg }}>
      <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: map.color }} />
      <span className="text-xs font-semibold" style={{ color: map.color }}>{map.text}</span>
    </div>
  );
}
