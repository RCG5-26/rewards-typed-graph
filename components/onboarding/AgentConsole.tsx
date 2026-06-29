"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import BackLink from "@/components/BackLink";
import { fromMutationEvent } from "@/lib/api/mutation-adapter";
import type { RealMutationEvent } from "@/lib/api/types";
import { dollars } from "@/lib/plan/comparison";
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
import type { PublicWalletFacts } from "@/lib/comparison/types";
import { isUserGraph, type UserBalance } from "@/lib/user/types";
import NodeDetailPopover from "./NodeDetailPopover";
import TypedGraph, { type HoverNode } from "./TypedGraph";
import WalletDataPanel from "./WalletDataPanel";
import WalletOptionsPanel from "./WalletOptionsPanel";


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

/** One program's balance before vs. after a transfer, for the replan summary. */
interface BalanceDelta {
  programId: string;
  name: string;
  before: number;
  after: number;
}

/** What the replan changed: which steps the new revision dropped + the balance moves. */
interface ReplanSummary {
  /** Steps present in revision N−1 but absent from the new revision (e.g. the transfer step). */
  removedSteps: PlanStep[];
  source: BalanceDelta | null;
  dest: BalanceDelta | null;
}

/** Steps in the prior revision that the new revision no longer contains (matched by type+title). */
function removedSteps(prior: PlanStep[], next: PlanStep[]): PlanStep[] {
  const key = (s: PlanStep) => `${s.type}::${s.title}`;
  const nextKeys = new Set(next.map(key));
  return prior.filter((s) => !nextKeys.has(key(s)));
}

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
  onEditWallet,
  balances = [],
  facts = null,
  walletProgramNames,
}: {
  queryText: string;
  selectedCardIds: string[];
  onRestart: () => void;
  /** Return to the cards step to edit the wallet (selection + points are preserved). */
  onEditWallet?: () => void;
  /** The user's real program balances (from `/api/me`) — powers the replan transfer control. */
  balances?: UserBalance[];
  /** Canonical wallet facts (transfer routes + award options) for the facts panel. */
  facts?: PublicWalletFacts | null;
  /** Programs the user carries — scopes the facts panel to relevant routes/awards. */
  walletProgramNames?: Set<string>;
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
  const [caughtInvalidation, setCaughtInvalidation] = useState(false);
  const [selected, setSelected] = useState<HoverNode | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  // The "what the agents see" facts were already shown on the ask step, so on
  // the plan page they start collapsed — available, but not competing with the
  // plan steps for attention.
  const [factsOpen, setFactsOpen] = useState(false);

  // ── user-driven replan ("I transferred points") ──
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSrc, setTransferSrc] = useState("");
  const [transferDest, setTransferDest] = useState("");
  const [transferAmt, setTransferAmt] = useState("");
  const [transferError, setTransferError] = useState<string | null>(null);
  const [replanSummary, setReplanSummary] = useState<ReplanSummary | null>(null);
  // Live balances: seeded from the prop, refreshed from /api/me after each replan
  // so repeat transfers validate/snapshot against current (not stale) balances.
  const [liveBalances, setLiveBalances] = useState<UserBalance[]>(balances);
  // Prior-revision snapshot captured at submit, resolved into a summary on `done`.
  const priorRef = useRef<{ steps: PlanStep[]; balances: UserBalance[]; src: string; dest: string } | null>(null);
  // Latest streamed steps — the `done` closure can't read `steps` state directly.
  const stepsRef = useRef<PlanStep[]>([]);
  // Synchronous guard so a double-click can't launch two replan streams.
  const replanInFlightRef = useRef(false);

  const esRef = useRef<EventSource | null>(null);
  const mutEsRef = useRef<EventSource | null>(null);
  const lastCursorRef = useRef<string>("0");
  const mutSeqRef = useRef<number>(1);
  const doneRef = useRef(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);

  function openStream(replan: boolean, transfer?: { src: string; dest: string; amt: number }) {
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
    if (transfer) {
      params.set("src", transfer.src);
      params.set("dest", transfer.dest);
      params.set("amt", String(transfer.amt));
    }
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
      stepsRef.current = meta.steps;
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
      if (replan) {
        replanInFlightRef.current = false; // allow the next transfer
        if (priorRef.current) void resolveReplanSummary();
      }
    });

    es.addEventListener("error", () => {
      if (!doneRef.current) setStatus("failed");
      replanInFlightRef.current = false; // release the guard on failure too
      es.close();
    });
  }

  /**
   * After a user-driven replan completes, diff the prior revision against the
   * new one (dropped steps) and refetch real balances to show before → after.
   */
  async function resolveReplanSummary() {
    const prior = priorRef.current;
    if (!prior) return;
    let after: UserBalance[] = prior.balances;
    try {
      const graph = await fetch("/api/me").then((r) => (r.ok ? r.json() : null));
      if (graph && isUserGraph(graph)) {
        after = graph.balances;
        setLiveBalances(graph.balances); // refresh so the next transfer uses current balances
      }
    } catch {
      // Network hiccup: fall back to the pre-transfer balances (delta shows 0).
    }
    const deltaFor = (programId: string): BalanceDelta | null => {
      const b = prior.balances.find((x) => x.programId === programId);
      const a = after.find((x) => x.programId === programId);
      const meta = a ?? b;
      if (!meta) return null;
      return {
        programId,
        name: meta.programName,
        before: b?.balancePoints ?? 0,
        after: a?.balancePoints ?? b?.balancePoints ?? 0,
      };
    };
    setReplanSummary({
      removedSteps: removedSteps(prior.steps, stepsRef.current),
      source: deltaFor(prior.src),
      dest: deltaFor(prior.dest),
    });
  }

  /** Validate the transfer form, snapshot the prior revision, and fire the replan. */
  function submitTransfer() {
    if (replanInFlightRef.current) return; // guard against double-submit
    const amt = Number(transferAmt);
    if (!transferSrc || !transferDest) {
      setTransferError("Pick a source and destination program.");
      return;
    }
    if (transferSrc === transferDest) {
      setTransferError("Source and destination must differ.");
      return;
    }
    if (!(amt > 0)) {
      setTransferError("Enter a positive amount.");
      return;
    }
    const srcBalance = liveBalances.find((b) => b.programId === transferSrc);
    if (srcBalance && amt > srcBalance.balancePoints) {
      setTransferError(`Only ${srcBalance.balancePoints.toLocaleString()} ${srcBalance.currencyName} available.`);
      return;
    }
    setTransferError(null);
    setReplanSummary(null);
    replanInFlightRef.current = true;
    priorRef.current = { steps, balances: liveBalances, src: transferSrc, dest: transferDest };
    setTransferOpen(false);
    openStream(true, { src: transferSrc, dest: transferDest, amt });
  }

  // Adopt a new balances prop (e.g. after a reset) unless we already have fresher
  // balances from a replan refetch this session.
  useEffect(() => {
    setLiveBalances((curr) => (curr.length === 0 ? balances : curr));
  }, [balances]);

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

  // Real plan value: the API plan contract carries no value field (toPlanResult
  // hardcodes 0), so we recompute it from the seed-verified facts — the cash
  // value of the best award the plan actually booked (pointsRequired × cpp). The
  // booked award shows up as a `redemption` node in the live graph; matching it
  // to a facts award by label yields the genuine value, not a placeholder.
  const derivedValueCents = useMemo(() => {
    if (!facts) return 0;
    const matchAward = (label: string) => {
      const l = label.toLowerCase();
      return facts.awardOptions.find(
        (a) => a.displayName.toLowerCase().includes(l) || l.includes(a.displayName.toLowerCase()),
      );
    };
    let best = 0;
    for (const node of graph.nodes) {
      if (node.kind !== "redemption") continue;
      const award = matchAward(node.label);
      if (!award) continue;
      const cents = Math.round((award.pointsRequired * award.valueBasisPoints) / 10000);
      if (cents > best) best = cents;
    }
    return best;
  }, [facts, graph.nodes]);

  // Prefer a live value from the stream if it ever arrives; otherwise fall back
  // to the facts-derived value so the metric is real, not an em dash.
  const effectiveValueCents = valueCents > 0 ? valueCents : derivedValueCents;

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

  return (
    <div className="absolute inset-0 z-[2] flex flex-col gap-4 overflow-y-auto px-7 pb-7 pt-5">
      {/* ── console header: title · phase · head-to-head link ── */}
      <div className="flex flex-none flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3.5">
          <div className="font-display text-xl font-semibold uppercase leading-none tracking-snug text-text-primary">
            agent console
          </div>
          <PhaseChip status={status} goalLabel={goalLabel} revision={revision} />
        </div>
        <div className="flex flex-none items-center gap-2.5">
          {/* Return to the wallet step to add/remove cards or edit points —
              selection and entered points are preserved by the parent flow. */}
          {onEditWallet && <BackLink onClick={onEditWallet}>edit wallet</BackLink>}
          {/* Head-to-head comparison lives on its own page now (the three
              architectures run against the canonical wallet there). Mirrors the
              BackLink pill (forward arrow) so the header cluster stays coherent
              and legible on the dark lane. */}
          <a
            href="/test-wallets"
            className="group inline-flex items-center gap-2 rounded-full border border-highlight-glow bg-surface px-4 py-2 text-xs font-semibold text-text-primary shadow-xs transition duration-base ease-spring-snappy hover:-translate-y-0.5 hover:border-highlight-glow hover:text-text-primary"
          >
            Compare planners live
            <span
              className="transition-transform duration-base group-hover:translate-x-0.5"
              aria-hidden="true"
            >
              →
            </span>
          </a>
        </div>
      </div>

      {/* ── illustrative-preview disclosure ──
          This console is a presentation of how a rewards Plan reads — its plan
          stream and the token comparison below are sample/illustrative, not a
          live run against the user's entered wallet. The live, evaluated run
          lives on the comparison page (CTA above + below). */}
      <div
        role="note"
        className="flex flex-none flex-col gap-1 rounded-card border border-strong bg-surface px-4 py-3 shadow-xs"
      >
        <span className="font-display text-xs font-semibold uppercase tracking-snug text-text-primary">
          Illustrative Plan Preview
        </span>
        <span className="text-2xs leading-relaxed text-text-secondary">
          Sample plan shown to demonstrate how a rewards Plan is presented. Continue to the live
          comparison to run the planners against a controlled wallet.
        </span>
      </div>

      {/* ── metric strip: estimated redemption value · state monitoring · model usage ── */}
      <div className="grid flex-none grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard label="estimated redemption value">
          <div className="flex items-center gap-3">
            <div className="flex items-baseline gap-1">
              <span className="font-display text-4xl font-semibold leading-none text-text-primary tabular-nums">
                {dollars(effectiveValueCents)}
              </span>
            </div>
            {prevValueCents !== null && prevValueCents !== effectiveValueCents && (
              <span
                className="rounded-full px-2 py-1 font-mono text-2xs font-medium"
                style={{ background: "var(--status-current-bg)", color: "var(--status-current)" }}
              >
                ↑ was {dollars(prevValueCents)}
              </span>
            )}
          </div>
        </MetricCard>

        <MetricCard label="state monitoring" tone="secondary">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs font-bold"
              style={{
                background: caughtInvalidation ? "var(--color-success-bg)" : "var(--color-surface-subtle)",
                color: caughtInvalidation ? "var(--color-success-fg)" : "var(--color-text-tertiary)",
              }}
            >
              {caughtInvalidation ? "✓" : "◴"}
            </span>
            <span className="text-sm font-medium text-text-secondary">
              {caughtInvalidation ? `dependency change · re-planned r${revision}` : "active"}
            </span>
          </div>
        </MetricCard>

        {/* Model usage. The typed-graph specialists are deterministic — they
            plan by committing graph mutations, with no LLM call — so planning
            costs 0 model tokens. (The measured baseline token costs live on the
            live comparison + benchmark pages; we never fabricate one here.) */}
        <MetricCard label="model usage" tone="secondary">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-2xl font-semibold leading-none tabular-nums text-text-primary">
              0
            </span>
            <span className="font-mono text-2xs text-text-tertiary">
              tokens · deterministic specialists, no LLM call
            </span>
          </div>
        </MetricCard>
      </div>

      {failed && steps.length === 0 ? (
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
              <div className="flex items-center justify-between gap-2 border-b border-subtle px-5 pb-3 pt-4">
                <div>
                  <div className="font-display text-xs font-semibold uppercase tracking-wide text-text-primary">
                    agent plan
                  </div>
                  <div className="mt-0.5 text-xs text-text-tertiary">
                    multi-step · per-step reasoning{revision > 1 ? ` · revision ${revision}` : ""}
                  </div>
                </div>
                {liveBalances.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setTransferError(null);
                      setTransferOpen((o) => !o);
                    }}
                    disabled={status === "streaming" || status === "replanning"}
                    aria-expanded={transferOpen}
                    className="flex-none rounded-full border border-DEFAULT bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary shadow-xs transition hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ⇄ I transferred points
                  </button>
                )}
              </div>
              {(liveBalances.length > 0 || facts) && (
                <div className="px-5 pt-3">
                  <button
                    type="button"
                    onClick={() => setFactsOpen((o) => !o)}
                    aria-expanded={factsOpen}
                    className="flex w-full items-center justify-between rounded-xl border border-subtle bg-surface-subtle px-3.5 py-2 text-left transition hover:border-highlight-glow"
                  >
                    <span className="font-mono text-2xs font-semibold uppercase tracking-wide text-text-tertiary">
                      what the agents see
                    </span>
                    <span className={`font-mono text-xs text-text-tertiary transition-transform ${factsOpen ? "rotate-180" : ""}`}>
                      ⌄
                    </span>
                  </button>
                  {factsOpen && (
                    <div className="mt-3 space-y-3">
                      {liveBalances.length > 0 && (
                        <WalletDataPanel
                          balances={liveBalances}
                          title="your points · what the agents see"
                        />
                      )}
                      {facts && (
                        <WalletOptionsPanel facts={facts} programNames={walletProgramNames} />
                      )}
                    </div>
                  )}
                </div>
              )}
              {transferOpen && (
                <TransferForm
                  balances={liveBalances}
                  src={transferSrc}
                  dest={transferDest}
                  amt={transferAmt}
                  error={transferError}
                  busy={status === "replanning"}
                  onSrc={setTransferSrc}
                  onDest={setTransferDest}
                  onAmt={setTransferAmt}
                  onSubmit={submitTransfer}
                  onCancel={() => setTransferOpen(false)}
                />
              )}
              {replanSummary && <ReplanSummaryBlock summary={replanSummary} revision={revision} />}
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
                        <div className="mt-2 truncate font-mono text-2xs text-text-tertiary">
                          provides {s.type}
                          {deps.length > 0 && ` · deps ${deps.map((d) => d.label).join(", ")}`}
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
              {/* footer — the plan stays live (auto re-plans); start a new one */}
              <div className="flex flex-none items-center justify-between gap-3 border-t border-subtle px-5 py-3.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-1.5 w-1.5 flex-none rounded-full"
                    style={{ background: "var(--status-current)", boxShadow: "0 0 6px var(--status-current)" }}
                  />
                  <span className="truncate font-mono text-2xs text-text-tertiary">
                    re-plans automatically when balances or transfer ratios change
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onRestart}
                  className="flex flex-none items-center gap-1.5 rounded-full border border-DEFAULT bg-surface px-4 py-2.5 text-sm font-medium text-text-secondary shadow-xs transition hover:text-text-primary"
                >
                  ↺ start over
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── metric strip card ────────────────────────────────────────────────
/**
 * `primary` is the visual hero (raised surface); `secondary` is a flat, muted
 * card so the supporting benchmark metrics recede instead of competing.
 */
function MetricCard({
  label,
  children,
  tone = "primary",
}: {
  label: string;
  children: ReactNode;
  tone?: "primary" | "secondary";
}) {
  const surface =
    tone === "primary"
      ? "bg-surface px-5 py-4 shadow-raised"
      : "bg-surface/50 px-5 py-4 ring-1 ring-border-subtle";
  return (
    <div className={`rounded-card ${surface}`}>
      <div className="mb-2.5 font-mono text-2xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">
        {label}
      </div>
      {children}
    </div>
  );
}

// ── user-driven replan: transfer form + summary ──────────────────────
function TransferForm({
  balances,
  src,
  dest,
  amt,
  error,
  busy,
  onSrc,
  onDest,
  onAmt,
  onSubmit,
  onCancel,
}: {
  balances: UserBalance[];
  src: string;
  dest: string;
  amt: string;
  error: string | null;
  busy: boolean;
  onSrc: (v: string) => void;
  onDest: (v: string) => void;
  onAmt: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const selectCls =
    "rounded-lg border border-DEFAULT bg-surface px-2.5 py-2 text-xs text-text-primary";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="border-b border-subtle px-5 py-3"
      style={{ background: "var(--color-surface-subtle)" }}
      aria-label="Record a balance transfer to re-plan"
    >
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1 text-2xs font-medium uppercase tracking-wide text-text-tertiary">
          From
          <select className={selectCls} value={src} onChange={(e) => onSrc(e.target.value)}>
            <option value="">Select program…</option>
            {balances.map((b) => (
              <option key={b.programId} value={b.programId}>
                {b.programName} ({b.balancePoints.toLocaleString()})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-2xs font-medium uppercase tracking-wide text-text-tertiary">
          To
          <select className={selectCls} value={dest} onChange={(e) => onDest(e.target.value)}>
            <option value="">Select program…</option>
            {balances.map((b) => (
              <option key={b.programId} value={b.programId}>
                {b.programName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-2xs font-medium uppercase tracking-wide text-text-tertiary">
          Amount
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={amt}
            onChange={(e) => onAmt(e.target.value)}
            placeholder="30000"
            className={`${selectCls} w-28 tabular-nums`}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-full px-4 py-2 text-xs font-semibold text-white shadow-xs transition disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: "var(--status-current)" }}
        >
          {busy ? "re-planning…" : "Apply & re-plan"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-3 py-2 text-xs font-medium text-text-tertiary transition hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs" style={{ color: "var(--status-failed)" }}>
          {error}
        </p>
      )}
    </form>
  );
}

function deltaText(d: BalanceDelta): string {
  const diff = d.after - d.before;
  const sign = diff > 0 ? "+" : "";
  return `${d.before.toLocaleString()} → ${d.after.toLocaleString()} (${sign}${diff.toLocaleString()})`;
}

function ReplanSummaryBlock({ summary, revision }: { summary: ReplanSummary; revision: number }) {
  return (
    <section
      aria-label="Re-plan summary"
      className="border-b border-subtle px-5 py-3"
      style={{ background: "var(--status-current-bg)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded font-mono text-2xs font-semibold"
          style={{ color: STATUS_VARS.superseded.color, background: STATUS_VARS.superseded.bg, padding: "2px 6px" }}
        >
          revision {Math.max(1, revision - 1)} · superseded
        </span>
        <span aria-hidden className="text-text-tertiary">
          →
        </span>
        <span
          className="rounded font-mono text-2xs font-semibold"
          style={{ color: STATUS_VARS.current.color, background: STATUS_VARS.current.bg, padding: "2px 6px" }}
        >
          revision {revision} · current
        </span>
      </div>
      {(summary.source || summary.dest) && (
        <dl className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
          {summary.source && (
            <div className="flex justify-between gap-2">
              <dt className="text-text-tertiary">{summary.source.name}</dt>
              <dd className="font-mono tabular-nums text-text-secondary">{deltaText(summary.source)}</dd>
            </div>
          )}
          {summary.dest && (
            <div className="flex justify-between gap-2">
              <dt className="text-text-tertiary">{summary.dest.name}</dt>
              <dd className="font-mono tabular-nums text-text-secondary">{deltaText(summary.dest)}</dd>
            </div>
          )}
        </dl>
      )}
      {summary.removedSteps.length > 0 && (
        <div className="mt-2 text-xs">
          <span className="text-text-tertiary">Removed from plan: </span>
          {summary.removedSteps.map((s, i) => (
            <span key={`${s.type}-${s.order}`} className="text-text-secondary">
              <span className="line-through">{s.title}</span>
              {i < summary.removedSteps.length - 1 ? ", " : ""}
            </span>
          ))}
        </div>
      )}
    </section>
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
