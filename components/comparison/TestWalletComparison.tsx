"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ArchitectureComparisonResponse,
  ArchitectureRunStatus,
  ArchitectureVariant,
  DemoSimulateTransferResponse,
  PublicBalance,
  PublicWalletFacts,
} from "@/lib/comparison/types";
import { formatPoints } from "@/lib/comparison/presentation";
import { ArchitectureResultCard, type CardState } from "./ArchitectureResultCard";
import { ArchitectureExecutionOverview, type LaneStatus } from "./ArchitectureExecutionOverview";
import { SharedExperimentInput } from "./SharedExperimentInput";

const CARD_ORDER: ArchitectureVariant[] = [
  "live-graph-orchestrator",
  "chat-crew",
  "single-agent",
];

/** Shared error-panel surface, driven by the design-system error tokens. */
const ERROR_PANEL_STYLE = {
  background: "var(--color-error-bg)",
  color: "var(--color-error-fg)",
  border: "1px solid color-mix(in srgb, var(--color-error) 24%, transparent)",
} as const;

/** Shared success-panel surface (replan result), driven by the success tokens. */
const SUCCESS_PANEL_STYLE = {
  background: "var(--color-success-bg)",
  border: "1px solid color-mix(in srgb, var(--color-success) 24%, transparent)",
} as const;

type RunPhase = "idle" | "running" | "done" | "error";
type SimulatePhase = "idle" | "running" | "done" | "error";

/**
 * The Test Wallets vertical slice: inspect the canonical wallet, run all three
 * architectures with one click, simulate the hero transfer to observe revision 2,
 * and read the three independent results side by side.
 */
export function TestWalletComparison({ wallets }: { wallets: PublicWalletFacts[] }) {
  const [selectedWalletId, setSelectedWalletId] = useState(wallets[0]?.walletId ?? "");
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [simulatePhase, setSimulatePhase] = useState<SimulatePhase>("idle");
  const [response, setResponse] = useState<ArchitectureComparisonResponse | null>(null);
  const [simulateResponse, setSimulateResponse] = useState<DemoSimulateTransferResponse | null>(
    null,
  );
  const [balanceOverrides, setBalanceOverrides] = useState<PublicBalance[] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [simulateError, setSimulateError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const runStartRef = useRef<number | null>(null);

  // Tick elapsed time while the comparison is running.
  useEffect(() => {
    if (phase !== "running") return;
    runStartRef.current = Date.now();
    setElapsedMs(0);
    const id = setInterval(() => {
      setElapsedMs(Date.now() - (runStartRef.current ?? Date.now()));
    }, 250);
    return () => clearInterval(id);
  }, [phase]);

  // Each async op claims the next generation; a completion only commits state
  // if it is still the current generation. This invalidates a stale simulate
  // when a new comparison/tab-switch starts (finding #1). `simulateInFlightRef`
  // is a synchronous lock that survives the render gap between rapid clicks so a
  // double-click cannot mint two idempotency keys (finding #3). The key lives in
  // a ref so concurrent clicks share one value before any re-render.
  const generationRef = useRef(0);
  const simulateInFlightRef = useRef(false);
  const idempotencyKeyRef = useRef<string | null>(null);

  const baseFacts = useMemo(
    () => wallets.find((w) => w.walletId === selectedWalletId) ?? wallets[0],
    [wallets, selectedWalletId],
  );

  const facts = useMemo(() => {
    if (!baseFacts) return baseFacts;
    if (!balanceOverrides) return baseFacts;
    return { ...baseFacts, balances: balanceOverrides };
  }, [baseFacts, balanceOverrides]);

  const graphReady = useMemo(() => {
    const graph = response?.results.find((r) => r.variant === "live-graph-orchestrator");
    return phase === "done" && graph?.status === "succeeded" && Boolean(graph.evidence?.lineageId);
  }, [phase, response]);

  const laneStatus = useMemo<LaneStatus>(() => {
    function resolveStatus(variant: ArchitectureVariant): ArchitectureRunStatus {
      if (phase === "running") return "running";
      const result = response?.results.find((r) => r.variant === variant);
      if (!result) return "not_started";
      return result.status;
    }
    return {
      graph: resolveStatus("live-graph-orchestrator"),
      chat: resolveStatus("chat-crew"),
      single: resolveStatus("single-agent"),
    };
  }, [phase, response]);

  function resetRun() {
    generationRef.current += 1;
    simulateInFlightRef.current = false;
    idempotencyKeyRef.current = null;
    setPhase("idle");
    setSimulatePhase("idle");
    setResponse(null);
    setSimulateResponse(null);
    setBalanceOverrides(null);
    setErrorMessage(null);
    setSimulateError(null);
  }

  async function runComparison() {
    if (!facts) return;
    const generation = ++generationRef.current;
    simulateInFlightRef.current = false;
    idempotencyKeyRef.current = null;
    setPhase("running");
    setSimulatePhase("idle");
    setResponse(null);
    setSimulateResponse(null);
    setBalanceOverrides(null);
    setErrorMessage(null);
    setSimulateError(null);
    try {
      const res = await fetch("/api/demo/architecture-comparison", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletId: facts.walletId }),
      });
      if (generation !== generationRef.current) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      setResponse((await res.json()) as ArchitectureComparisonResponse);
      setPhase("done");
    } catch (error) {
      if (generation !== generationRef.current) return;
      setErrorMessage(error instanceof Error ? error.message : "Comparison failed.");
      setPhase("error");
    }
  }

  async function simulateTransfer() {
    if (!facts || !graphReady) return;
    if (simulateInFlightRef.current) return;
    simulateInFlightRef.current = true;
    const generation = ++generationRef.current;
    setSimulatePhase("running");
    setSimulateError(null);
    const key = idempotencyKeyRef.current ?? crypto.randomUUID();
    idempotencyKeyRef.current = key;

    try {
      const res = await fetch("/api/demo/simulate-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletId: facts.walletId, idempotencyKey: key }),
      });
      if (generation !== generationRef.current) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const payload = (await res.json()) as DemoSimulateTransferResponse;
      setSimulateResponse(payload);
      setSimulatePhase("done");

      setResponse((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          results: prev.results.map((result) =>
            result.variant === "live-graph-orchestrator" ? payload.graphResult : result,
          ),
        };
      });

      if (!payload.idempotencyReplayed) {
        setBalanceOverrides(
          applyTransferToBalances(facts.balances, payload.transfer),
        );
      }
    } catch (error) {
      if (generation !== generationRef.current) return;
      setSimulateError(error instanceof Error ? error.message : "Transfer simulation failed.");
      setSimulatePhase("error");
    } finally {
      if (generation === generationRef.current) simulateInFlightRef.current = false;
    }
  }

  function cardState(variant: ArchitectureVariant): CardState {
    if (phase === "running") return { phase: "loading" };
    const result = response?.results.find((r) => r.variant === variant);
    if (result) return { phase: "result", result };
    return { phase: "idle" };
  }

  if (!facts) {
    return (
      <p className="text-sm text-text-tertiary">No test wallets are available from the API.</p>
    );
  }

  // Headline award for the compact summary (prefer an available one).
  const primaryAward = facts.awardOptions.find((a) => a.available) ?? facts.awardOptions[0] ?? null;
  const totalPoints = facts.balances.reduce((sum, b) => sum + b.points, 0);
  // Reveal result cards only once a run begins or results arrive — no empty
  // placeholder cards before execution.
  const showResultCards = phase === "running" || response !== null;

  return (
    <div className="space-y-6">
      {wallets.length > 1 ? (
        <div className="flex gap-2" role="tablist" aria-label="Test wallets">
          {wallets.map((wallet) => (
            <button
              key={wallet.walletId}
              role="tab"
              aria-selected={wallet.walletId === selectedWalletId}
              onClick={() => {
                setSelectedWalletId(wallet.walletId);
                resetRun();
              }}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                wallet.walletId === selectedWalletId
                  ? "bg-highlight text-on-highlight"
                  : "border border-strong text-text-secondary hover:text-text-primary"
              }`}
            >
              {wallet.displayName}
            </button>
          ))}
        </div>
      ) : null}

      {/* Compact scenario summary — keeps the pre-run view short. The full,
          server-derived facts table is one click away (progressive disclosure)
          so the page is not excessively tall before results arrive. */}
      <section
        className="rounded-card border border-subtle bg-surface p-5"
        aria-label="Scenario summary"
      >
        <h2 className="text-sm font-semibold text-text-primary">
          Controlled scenario: {facts.displayName}
        </h2>
        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1.5 font-mono text-2xs text-text-secondary">
          <span className="rounded-full border border-subtle px-2 py-0.5">
            {facts.goal.nights}-night {facts.goal.category.replace(/_/g, " ")} · {facts.goal.destination}
          </span>
          <span className="rounded-full border border-subtle px-2 py-0.5">
            {facts.balances.length} programs · {formatPoints(totalPoints)} pts
          </span>
          {primaryAward ? (
            <span className="rounded-full border border-subtle px-2 py-0.5">
              {primaryAward.displayName} · {formatPoints(primaryAward.pointsRequired)}
            </span>
          ) : null}
        </div>
      </section>

      <details className="rounded-card border border-subtle bg-surface">
        <summary className="cursor-pointer list-none px-5 py-3 text-sm font-medium text-text-secondary transition hover:text-text-primary [&::-webkit-details-marker]:hidden">
          View complete scenario details
        </summary>
        <div className="border-t border-subtle">
          <SharedExperimentInput facts={facts} />
        </div>
      </details>

      <ArchitectureExecutionOverview laneStatus={laneStatus} />

      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={runComparison}
          disabled={phase === "running" || simulatePhase === "running"}
          className="rounded-full bg-highlight px-6 py-2.5 text-sm font-semibold text-on-highlight shadow-lg transition hover:bg-highlight-hover disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            boxShadow:
              "0 8px 28px color-mix(in srgb, var(--color-highlight-glow) 38%, transparent)",
          }}
          aria-busy={phase === "running"}
        >
          {phase === "running"
            ? `Running all three… ${(elapsedMs / 1000).toFixed(1)}s`
            : "Run comparison"}
        </button>

        <button
          onClick={simulateTransfer}
          disabled={!graphReady || simulatePhase === "running"}
          title={
            graphReady
              ? "Apply the 15,000-point Chase→Hyatt transfer, invalidate the dependent Plan, and replan"
              : "Run the comparison first to enable this action"
          }
          className="rounded-full border border-strong bg-surface px-6 py-2.5 text-sm font-semibold text-text-secondary transition hover:border-highlight-glow hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          {simulatePhase === "running"
            ? "Applying transfer…"
            : simulateResponse?.idempotencyReplayed
              ? "Transfer already applied"
              : "Complete 15,000-point transfer"}
        </button>
      </div>

      {phase === "error" && errorMessage ? (
        <div className="rounded-card p-4 text-sm" style={ERROR_PANEL_STYLE}>
          {errorMessage}
        </div>
      ) : null}

      {simulatePhase === "error" && simulateError ? (
        <div className="rounded-card p-4 text-sm" style={ERROR_PANEL_STYLE}>
          {simulateError}
        </div>
      ) : null}

      {simulateResponse ? (
        <ReplanStatusPanel response={simulateResponse} />
      ) : null}

      {/* Screen-reader-only status announcement when comparison completes */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {phase === "done"
          ? `Comparison complete. ${response?.results.filter((r) => r.status === "succeeded").length ?? 0} of ${response?.results.length ?? 3} architectures succeeded.`
          : phase === "error"
            ? `Comparison failed: ${errorMessage ?? "unknown error"}`
            : null}
      </div>

      {showResultCards ? (
        <div
          className="grid gap-4 lg:grid-cols-3"
          aria-label="Architecture comparison results"
          aria-busy={phase === "running"}
        >
          {CARD_ORDER.map((variant) => (
            <ArchitectureResultCard
              key={variant}
              variant={variant}
              facts={facts}
              state={cardState(variant)}
            />
          ))}
        </div>
      ) : (
        <div
          className="rounded-card border border-dashed border-strong bg-surface p-10 text-center"
          aria-label="Comparison results"
        >
          <p className="text-sm text-text-secondary">
            Run the comparison to generate three independently evaluated Plans.
          </p>
          <p className="mt-1.5 font-mono text-2xs text-text-tertiary">
            Graph Crew · Chat Crew · Single Agent — same inputs, one deterministic evaluator.
          </p>
        </div>
      )}
    </div>
  );
}

function applyTransferToBalances(
  balances: PublicBalance[],
  transfer: DemoSimulateTransferResponse["transfer"],
): PublicBalance[] {
  return balances.map((balance) => {
    if (balance.programId === transfer.sourceProgramId) {
      return {
        ...balance,
        points: balance.points - transfer.amountPoints,
        version: balance.version + 1,
      };
    }
    if (balance.programId === transfer.destProgramId) {
      return {
        ...balance,
        points: balance.points + transfer.amountPoints,
        version: balance.version + 1,
      };
    }
    return balance;
  });
}

function ReplanStatusPanel({ response }: { response: DemoSimulateTransferResponse }) {
  const { currentPlan, idempotencyReplayed, transfer } = response;
  const hasTransferStep = currentPlan.steps.some((step) =>
    step.type.toLowerCase().includes("transfer"),
  );

  return (
    <div
      className="rounded-card p-5 text-sm"
      style={SUCCESS_PANEL_STYLE}
      aria-live="polite"
      aria-label="Replan result"
    >
      <h3 className="font-semibold" style={{ color: "var(--color-success-fg)" }}>
        {idempotencyReplayed
          ? "Transfer already applied — Plan unchanged"
          : `Revision ${currentPlan.revisionNumber} is now current`}
      </h3>
      {idempotencyReplayed ? (
        <p className="mt-1 text-xs text-text-secondary">
          Idempotent replay — balances and Plan revision unchanged.
        </p>
      ) : null}

      {/* Balance version transitions */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <BalanceVersionCard
          programName="Chase Ultimate Rewards"
          before={transfer.amountPoints !== undefined ? undefined : 0}
          deduction={transfer.amountPoints}
          replayed={idempotencyReplayed}
        />
        <BalanceVersionCard
          programName="World of Hyatt"
          before={transfer.amountPoints !== undefined ? undefined : 0}
          addition={transfer.amountPoints}
          replayed={idempotencyReplayed}
        />
      </div>

      {/* Plan revision timeline */}
      {!idempotencyReplayed ? (
        <div className="mt-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-success">
            Plan revision timeline
          </h4>
          <ol className="space-y-1.5 border-l border-subtle pl-3">
            <li className="text-xs text-text-tertiary">
              <span className="font-medium text-text-secondary">Revision 1</span> — stale →
              superseded
              <span className="block text-text-tertiary">
                Dependency on Hyatt balance v1 invalidated
              </span>
            </li>
            <li className="text-xs text-text-secondary">
              <span className="font-medium text-text-primary">Revision {currentPlan.revisionNumber}</span>{" "}
              — current
              <span className="block text-text-tertiary">
                {hasTransferStep
                  ? "Transfer still present (balance not yet sufficient)"
                  : "No transfer required — Hyatt balance now covers the award"}
              </span>
            </li>
          </ol>
        </div>
      ) : null}

      {/* Summary steps from revision 2 */}
      {!idempotencyReplayed && currentPlan.steps.length > 0 ? (
        <div className="mt-3">
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-success">
            Revision {currentPlan.revisionNumber} steps
          </h4>
          <ol className="space-y-1">
            {currentPlan.steps.map((step) => (
              <li key={step.order} className="text-xs text-text-secondary">
                {step.order}. {step.summary}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {response.replanJobId ? (
        <p className="mt-3 font-mono text-[11px] text-text-tertiary">
          Replan job: {response.replanJobId.slice(0, 8)}…
        </p>
      ) : null}
    </div>
  );
}

function BalanceVersionCard({
  programName,
  deduction,
  addition,
  replayed,
}: {
  programName: string;
  before?: number;
  deduction?: number;
  addition?: number;
  replayed: boolean;
}) {
  const amount = deduction ?? addition;
  return (
    <div className="rounded-lg border border-subtle bg-surface p-3">
      <p className="text-xs font-medium text-text-primary">{programName}</p>
      {replayed ? (
        <p className="mt-1 text-xs text-text-tertiary">
          Unchanged (idempotent replay)
        </p>
      ) : (
        <p className="mt-1 font-mono text-xs text-text-secondary">
          v1 →{" "}
          <span className="font-semibold text-text-primary">v2</span>
          {amount ? (
            <span className="ml-2 text-text-tertiary">
              ({deduction ? "−" : "+"}
              {formatPoints(amount)} pts)
            </span>
          ) : null}
        </p>
      )}
    </div>
  );
}
