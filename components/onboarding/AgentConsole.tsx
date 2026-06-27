"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import { fromMutationEvent } from "@/lib/api/mutation-adapter";
import type { RealMutationEvent } from "@/lib/api/types";
import { deriveComparison, dollars, fmtTokens, type LiveMetrics } from "@/lib/plan/comparison";
import { AGENT_META, agentDarkColor, opColor } from "@/lib/plan/presentation";
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
import NodeDetailPopover from "./NodeDetailPopover";
import TypedGraph, { type HoverNode } from "./TypedGraph";

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

/** Where a keyboard-selected node's popover anchors (no pointer coordinates). */
const KEYBOARD_POPOVER_Y = 160;

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
  const [caughtInvalidation, setCaughtInvalidation] = useState(false);
  const [view, setView] = useState<ConsoleView>("plan");
  const [selected, setSelected] = useState<HoverNode | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const esRef = useRef<EventSource | null>(null);
  const mutEsRef = useRef<EventSource | null>(null);
  const lastCursorRef = useRef<string>("0");
  const mutSeqRef = useRef<number>(1);
  const doneRef = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);

  function openStream(replan: boolean) {
    esRef.current?.close();
    mutEsRef.current?.close();
    doneRef.current = false;
    const valueAtStart = valueCents;

    // Open the real mutations SSE first, starting from the last known cursor.
    // Events arrive with event name "graph_mutation" and carry full MutationEvent
    // JSON — converted to MutationLogEntry for the panel.
    const mutEs = new EventSource(
      `/api/mutations/stream?after=${lastCursorRef.current}`,
    );
    mutEsRef.current = mutEs;
    mutEs.addEventListener("graph_mutation", (ev) => {
      const event = JSON.parse((ev as MessageEvent).data) as RealMutationEvent;
      lastCursorRef.current = event.event_id;
      const entry = fromMutationEvent(event, mutSeqRef.current++);
      setMutations((m) => [...m, entry]);
      if (entry.nodeId) setLit((s) => new Set(s).add(entry.nodeId as string));
    });

    // Plan lifecycle stream: meta, invalidation, done — no mutation events.
    const params = new URLSearchParams({ q: queryText });
    if (selectedCardIds.length) params.set("cards", selectedCardIds.join(","));
    if (replan) params.set("replan", "1");
    const es = new EventSource(`/api/plan/stream?${params.toString()}`);
    esRef.current = es;

    es.addEventListener("invalidation", (ev) => {
      const inv = JSON.parse((ev as MessageEvent).data) as Invalidation;
      setStatus("replanning");
      setGraph((g) => applyInvalidation(g, inv));
      // The real MarkStale row arrives via mutEs; only apply graph animation here.
      setCaughtInvalidation(true);
    });

    es.addEventListener("meta", (ev) => {
      const meta = JSON.parse((ev as MessageEvent).data) as Meta;
      setSteps(meta.steps);
      setGraph((g) => mergeGraph(g, meta.graph));
      if (typeof meta.planValueCents === "number") setValueCents(meta.planValueCents);
      setLiveNodes(meta.liveNodes);
      setRoute(meta.route);
      setGoalLabel(meta.goalLabel);
      setRevision(meta.revision);
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
      // Keep mutEs open so replan mutations continue to arrive if triggered.
    });

    es.addEventListener("error", () => {
      if (!doneRef.current) setStatus("failed");
      es.close();
    });
  }

  // Open the initial stream once.
  useEffect(() => {
    openStream(false);
    return () => {
      esRef.current?.close();
      mutEsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the mutation log scrolled to the newest row.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [mutations]);

  const failed = status === "failed";

  const liveMetrics: LiveMetrics = {
    planValueCents: valueCents,
    opCount: mutations.length,
    invalidationCaught: caughtInvalidation,
    revision,
  };

  function triggerReplan() {
    if (replanned) return;
    setReplanned(true);
    openStream(true);
  }

  // Keyboard-accessible entry point to the same node detail the canvas exposes
  // via pointer. The canvas is aria-hidden, so this is the only path for
  // keyboard / assistive-tech users; it anchors the popover centered in the rail.
  function selectNodeById(id: string) {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) return;
    const railWidth = railRef.current?.clientWidth ?? 0;
    setSelected({
      id: node.id,
      label: node.label,
      kind: node.kind,
      x: railWidth ? railWidth / 2 : 0,
      y: KEYBOARD_POPOVER_Y,
    });
  }

  const cmp = deriveComparison(liveMetrics);
  // Tokens vs the free-text baseline (CrewAI) — the headline efficiency win.
  const tokenSavingPct =
    cmp.crewai.tokens > 0 ? Math.round((1 - cmp.typed.tokens / cmp.crewai.tokens) * 100) : 0;

  return (
    <div className="absolute inset-0 z-[2] flex flex-col gap-4 overflow-y-auto px-7 pb-7 pt-5">
      {/* ── console header: title · phase · view tabs ── */}
      <div className="flex flex-none flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <div className="font-display text-xl font-semibold uppercase leading-none tracking-snug text-text-primary">
            agent console
          </div>
          <PhaseChip status={status} goalLabel={goalLabel} revision={revision} />
        </div>
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
      </div>

      {/* ── metric strip: plan value · invalidation caught · tokens vs baseline ── */}
      <div className="grid flex-none grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard label="plan value">
          <div className="flex items-center gap-3">
            <div className="flex items-baseline gap-1">
              <span className="font-display text-4xl font-semibold leading-none text-text-primary tabular-nums">
                {dollars(valueCents)}
              </span>
              <span className="font-mono text-2xs text-text-tertiary">/ yr</span>
            </div>
            {prevValueCents !== null && prevValueCents !== valueCents && (
              <span
                className="rounded-full px-2 py-1 font-mono text-2xs font-medium"
                style={{ background: "var(--status-current-bg)", color: "var(--status-current)" }}
              >
                ↑ was {dollars(prevValueCents)}
              </span>
            )}
          </div>
        </MetricCard>

        <MetricCard label="invalidation caught">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-sm font-bold"
              style={{
                background: caughtInvalidation ? "var(--color-success-bg)" : "var(--color-surface-subtle)",
                color: caughtInvalidation ? "var(--color-success-fg)" : "var(--color-text-tertiary)",
              }}
            >
              {caughtInvalidation ? "✓" : "◴"}
            </span>
            <span className="text-lg font-semibold text-text-primary">
              {caughtInvalidation ? `auto re-planned · r${revision}` : "watching state"}
            </span>
          </div>
        </MetricCard>

        <MetricCard label="tokens vs baseline">
          <div className="flex items-center justify-between gap-3">
            <span
              className="font-display text-4xl font-semibold leading-none tabular-nums"
              style={{ color: "var(--color-accent-text)" }}
            >
              −{tokenSavingPct}%
            </span>
            <div className="flex items-end gap-3">
              <TokenBar
                label="current"
                value={fmtTokens(cmp.typed.tokens)}
                pct={cmp.crewai.tokens > 0 ? Math.round((cmp.typed.tokens / cmp.crewai.tokens) * 100) : 100}
                accent
              />
              <TokenBar label="baseline" value={fmtTokens(cmp.crewai.tokens)} pct={100} />
            </div>
          </div>
        </MetricCard>
      </div>

      {view === "baselines" ? (
        <div className="flex min-h-[360px] flex-1 flex-col">
          <ContrastView metrics={liveMetrics} />
        </div>
      ) : view === "benchmark" ? (
        <div className="flex min-h-[360px] flex-1 flex-col">
          <BenchmarkView metrics={liveMetrics} />
        </div>
      ) : failed && steps.length === 0 ? (
        <div className="flex min-h-[320px] flex-1 items-center justify-center rounded-card bg-surface text-sm text-error-fg shadow-raised">
          Could not build a plan. Try resetting.
        </div>
      ) : (
        <>
          {/* ── main row: typed-graph traversal (left) + agent plan (right) ── */}
          <div className="grid min-h-[440px] flex-1 grid-cols-1 gap-4 lg:grid-cols-[1.05fr_1fr]">
            {/* left — typed-graph traversal card (dark) */}
            <div
              ref={railRef}
              className="relative flex flex-col overflow-hidden rounded-card p-6"
              style={{ background: "#060912", boxShadow: "0 4px 22px rgba(10,14,30,0.25), inset 0 0 0 1px rgba(125,166,255,0.12)" }}
            >
              <div className="relative z-10 flex items-start justify-between">
                <div className="font-display text-2xs font-semibold uppercase tracking-widest text-[#a0beff]/85">
                  typed-graph traversal
                </div>
                <div
                  className="flex items-center gap-2 rounded-full px-3 py-1.5 backdrop-blur"
                  style={{ background: "rgba(134,168,255,0.14)", border: "1px solid rgba(134,168,255,0.32)" }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: "oklch(78% 0.14 248)", boxShadow: "0 0 10px oklch(78% 0.14 248)" }} />
                  <span className="text-2xs font-semibold text-[#dce8ff]/90">{liveNodes} nodes live</span>
                </div>
              </div>

              {/* canvas fills the middle; the plane flies the live route */}
              <div className="relative my-4 min-h-0 flex-1">
                <TypedGraph graph={graph} litNodeIds={lit} onSelect={setSelected} />
              </div>

              {/* Keyboard / assistive-tech path to node details (canvas is aria-hidden). */}
              {graph.nodes.length > 0 && (
                <div className="sr-only">
                  <h2>Plan graph nodes</h2>
                  <ul>
                    {graph.nodes.map((n) => (
                      <li key={n.id}>
                        <button type="button" onClick={() => selectNodeById(n.id)}>
                          View details for {n.label} ({n.kind})
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {selected && (
                <NodeDetailPopover
                  node={selected}
                  state={graph.nodes.find((n) => n.id === selected.id)?.state ?? "active"}
                  isLit={lit.has(selected.id)}
                  ops={mutations.filter((m) => m.nodeId === selected.id)}
                  containerWidth={railRef.current?.clientWidth ?? 0}
                  onClose={() => setSelected(null)}
                />
              )}

              <div className="pointer-events-none relative z-10 mb-3 max-w-[280px] font-mono text-2xs leading-relaxed text-white/55">
                {route || "resolving…"}
              </div>

              {/* collapsible graph-mutation log — closed reads as a status bar */}
              <button
                type="button"
                onClick={() => setLogOpen((o) => !o)}
                className="relative z-10 flex items-center justify-between rounded-xl px-4 py-3 text-left transition"
                style={{ background: "rgba(134,168,255,0.08)", border: "1px solid rgba(125,166,255,0.16)" }}
                aria-expanded={logOpen}
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-2xs text-[#a0beff]/70">›_</span>
                  <span className="font-display text-2xs font-semibold uppercase tracking-wide text-[#dce8ff]/90">
                    graph mutations · {mutations.length} ops
                  </span>
                </span>
                <span className={`font-mono text-xs text-[#a0beff]/70 transition-transform ${logOpen ? "rotate-180" : ""}`}>⌄</span>
              </button>

              {logOpen && (
                <div
                  ref={logRef}
                  className="relative z-10 mt-2 max-h-[180px] overflow-y-auto rounded-xl px-2 py-1.5"
                  style={{ background: "rgba(8,13,24,0.6)", border: "1px solid rgba(125,166,255,0.12)" }}
                >
                  {mutations.map((m) => {
                    const meta = AGENT_META[m.agentType];
                    return (
                      <div key={m.seq} className="mb-1 flex gap-2 rounded-lg px-2 py-1.5" style={{ background: "rgba(134,168,255,0.04)", animation: "gp-row-in 0.3s ease" }}>
                        <span className="w-[18px] flex-none pt-0.5 text-right font-mono text-2xs text-[#a0beff]/40">{m.seq}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 flex-none rounded-sm" style={{ background: agentDarkColor(meta) }} />
                            <span className="font-mono text-2xs font-semibold" style={{ color: agentDarkColor(meta) }}>{meta.short}</span>
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
              )}
            </div>

            {/* right — agent plan card */}
            <div className="flex min-h-0 flex-col overflow-hidden rounded-card bg-surface shadow-raised">
              <div className="flex items-center justify-between border-b border-subtle px-5 pb-3 pt-4">
                <div>
                  <div className="font-display text-xs font-semibold uppercase tracking-wide text-text-primary">
                    agent plan
                  </div>
                  <div className="mt-0.5 text-xs text-text-tertiary">
                    multi-step · per-step reasoning{revision > 1 ? ` · revision ${revision}` : ""}
                  </div>
                </div>
              </div>
              {steps.length > 0 && <RouteBar steps={steps} />}
              <div className="flex-1 overflow-y-auto px-5 py-1">
                {steps.map((s, i) => {
                  const meta = AGENT_META[s.agentType];
                  const sv = STATUS_VARS[s.status];
                  const deps = s.dependencies ?? s.deps.map((d) => ({ id: d, label: d, slug: d }));
                  return (
                    <div key={`${revision}-${s.order}`} className="flex gap-3.5 border-b border-subtle py-3.5 last:border-0">
                      <div className="flex flex-none flex-col items-center gap-1.5">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-subtle font-mono text-2xs font-semibold text-text-tertiary tabular-nums">
                          {i + 1}
                        </span>
                        <div
                          className="flex h-8 w-8 items-center justify-center rounded-lg font-mono text-2xs font-semibold"
                          style={{ background: `${meta.color}14`, color: meta.color, border: `1px solid ${meta.color}33` }}
                        >
                          {meta.short}
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-text-primary">{s.title}</span>
                          <span className="rounded font-mono text-2xs font-medium" style={{ color: sv.color, background: sv.bg, padding: "2px 6px" }}>
                            {s.status}
                          </span>
                        </div>
                        <div className="mt-1.5 text-xs leading-relaxed text-text-secondary">{s.reasoning}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {deps.length > 0 && (
                            <span className="inline-flex max-w-full items-center gap-1 truncate rounded font-mono text-2xs text-text-secondary" style={{ background: "var(--color-surface-subtle)", border: "1px solid var(--color-border)", padding: "2px 7px" }}>
                              deps: {deps.map((d) => d.label).join(", ")}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 rounded font-mono text-2xs font-medium" style={{ background: "var(--color-accent-muted)", color: "var(--color-accent-text)", padding: "2px 7px" }}>
                            provides: {s.type}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {steps.length === 0 && (
                  <div className="flex h-full min-h-[160px] items-center justify-center text-sm text-text-tertiary">
                    {status === "streaming" ? "agents drafting the plan…" : "no steps yet"}
                  </div>
                )}
              </div>
              {/* footer actions — simulate a balance change · reset */}
              <div className="flex flex-none items-center gap-2.5 border-t border-subtle px-5 py-3.5">
                <button
                  type="button"
                  onClick={triggerReplan}
                  disabled={replanned || status !== "current"}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full bg-neutral-900 px-4 py-3 text-sm font-medium text-white shadow-md transition duration-base ease-spring-snappy hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
                >
                  ⚡ Simulate a balance change
                </button>
                <button
                  type="button"
                  onClick={onRestart}
                  className="flex flex-none items-center gap-1.5 rounded-full border border-DEFAULT bg-surface px-4 py-3 text-sm font-medium text-text-secondary shadow-xs transition hover:text-text-primary"
                >
                  ↺ reset
                </button>
              </div>
            </div>
          </div>

          {/* ── bottom: three-architecture comparison summary ── */}
          <ComparisonStrip onOpen={() => setView("baselines")} />
        </>
      )}
    </div>
  );
}

// ── metric strip card ────────────────────────────────────────────────
function MetricCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-card bg-surface px-5 py-4 shadow-raised">
      <div className="mb-2.5 font-mono text-2xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">
        {label}
      </div>
      {children}
    </div>
  );
}

function TokenBar({ label, value, pct, accent }: { label: string; value: string; pct: number; accent?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-mono text-[10px] text-text-tertiary tabular-nums">{value}</span>
      <div
        className="w-7 rounded-sm"
        style={{
          height: `${Math.max(8, Math.min(34, (pct / 100) * 34))}px`,
          background: accent ? "var(--color-accent)" : "var(--color-neutral-300)",
        }}
      />
      <span className="font-mono text-[9px] uppercase tracking-wide text-text-tertiary">{label}</span>
    </div>
  );
}

// ── bottom comparison strip (condensed baselines) ────────────────────
function ComparisonStrip({ onOpen }: { onOpen: () => void }) {
  const cols = [
    {
      key: "typed",
      title: "Typed graph",
      badge: "BEST",
      badgeStyle: { background: "var(--color-accent-muted)", color: "var(--color-accent-text)" },
      accent: "var(--color-accent)",
      marks: [
        { ok: true, t: "Validity aware" },
        { ok: true, t: "Up-to-date" },
        { ok: true, t: "Higher value" },
      ],
    },
    {
      key: "crewai",
      title: "CrewAI free-text",
      badge: "LOWER VALUE",
      badgeStyle: { background: "var(--color-warning-bg)", color: "var(--color-warning-fg)" },
      accent: "var(--color-warning)",
      marks: [
        { ok: true, t: "Natural language" },
        { ok: false, t: "Validation gaps" },
        { ok: false, t: "Lower value" },
      ],
    },
    {
      key: "single",
      title: "Single agent",
      badge: "LOWEST VALUE",
      badgeStyle: { background: "var(--color-surface-subtle)", color: "var(--color-text-tertiary)" },
      accent: "var(--color-neutral-500)",
      marks: [
        { ok: true, t: "Simple" },
        { ok: false, t: "No validation" },
        { ok: false, t: "Lowest value" },
      ],
    },
  ] as const;

  return (
    <div className="grid flex-none grid-cols-1 gap-3 md:grid-cols-3">
      {cols.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={onOpen}
          className="flex flex-col rounded-card bg-surface p-4 text-left shadow-raised transition duration-base hover:-translate-y-0.5 hover:shadow-float"
          style={c.key === "typed" ? { border: "1px solid var(--color-accent-subtle)" } : undefined}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.accent }} />
              <span className="font-display text-sm font-semibold text-text-primary">{c.title}</span>
            </div>
            <span className="rounded font-mono text-[10px] font-semibold uppercase tracking-wide" style={{ ...c.badgeStyle, padding: "2px 7px" }}>
              {c.badge}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {c.marks.map((m) => (
              <span key={m.t} className="flex items-center gap-1.5 text-xs text-text-secondary">
                <span
                  className="flex h-4 w-4 flex-none items-center justify-center rounded-full text-[9px] font-bold"
                  style={{
                    background: m.ok ? "var(--color-success-bg)" : "var(--color-warning-bg)",
                    color: m.ok ? "var(--color-success-fg)" : "var(--color-warning-fg)",
                  }}
                >
                  {m.ok ? "✓" : "✕"}
                </span>
                {m.t}
              </span>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}

function RouteBar({ steps }: { steps: PlanStep[] }) {
  const hasTransfer = steps.some((s) => s.type === "transfer_recommendation");
  const isDirect = !hasTransfer;

  return (
    <div
      className="flex items-center gap-3 border-b border-subtle px-5 py-3"
      style={{ background: "var(--color-surface-subtle)" }}
    >
      {isDirect ? (
        <>
          <span
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ background: "oklch(52% 0.18 155 / 0.12)", color: "oklch(52% 0.18 155)" }}
          >
            Hyatt Points
          </span>
          <span className="text-text-tertiary">→</span>
          <span className="text-xs font-medium text-text-secondary">
            book hotel directly · no transfer needed
          </span>
        </>
      ) : (
        <>
          <span
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ background: "oklch(58% 0.2 248 / 0.12)", color: "oklch(58% 0.2 248)" }}
          >
            Chase UR
          </span>
          <span className="text-text-tertiary">→</span>
          <span
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ background: "oklch(52% 0.18 155 / 0.12)", color: "oklch(52% 0.18 155)" }}
          >
            World of Hyatt
          </span>
          <span className="text-text-tertiary">→</span>
          <span className="text-xs font-medium text-text-secondary">
            book hotel with transferred points
          </span>
        </>
      )}
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
