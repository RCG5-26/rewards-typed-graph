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
      <p className="text-sm text-white/60">No test wallets are available from the API.</p>
    );
  }

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
              className={`rounded-full px-4 py-1.5 text-sm transition ${
                wallet.walletId === selectedWalletId
                  ? "bg-white text-black"
                  : "border border-white/15 text-white/70 hover:text-white"
              }`}
            >
              {wallet.displayName}
            </button>
          ))}
        </div>
      ) : null}

      <SharedExperimentInput facts={facts} />

      <ArchitectureExecutionOverview laneStatus={laneStatus} />

      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={runComparison}
          disabled={phase === "running" || simulatePhase === "running"}
          className="rounded-full bg-indigo-400 px-6 py-2.5 text-sm font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
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
          className="rounded-full border border-white/20 px-6 py-2.5 text-sm font-semibold text-white transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {simulatePhase === "running"
            ? "Applying transfer…"
            : simulateResponse?.idempotencyReplayed
              ? "Transfer already applied"
              : "Complete 15,000-point transfer"}
        </button>
      </div>

      {phase === "error" && errorMessage ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-200">
          {errorMessage}
        </div>
      ) : null}

      {simulatePhase === "error" && simulateError ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-200">
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
      className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-sm"
      aria-live="polite"
      aria-label="Replan result"
    >
      <h3 className="font-semibold text-emerald-200">
        {idempotencyReplayed
          ? "Transfer already applied — Plan unchanged"
          : `Revision ${currentPlan.revisionNumber} is now current`}
      </h3>
      {idempotencyReplayed ? (
        <p className="mt-1 text-xs text-emerald-100/60">
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
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-300/60">
            Plan revision timeline
          </h4>
          <ol className="space-y-1.5 border-l border-emerald-500/20 pl-3">
            <li className="text-xs text-emerald-100/55">
              <span className="font-medium text-emerald-100/70">Revision 1</span> — stale →
              superseded
              <span className="block text-emerald-100/40">
                Dependency on Hyatt balance v1 invalidated
              </span>
            </li>
            <li className="text-xs text-emerald-100/85">
              <span className="font-medium text-emerald-200">Revision {currentPlan.revisionNumber}</span>{" "}
              — current
              <span className="block text-emerald-100/55">
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
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-300/60">
            Revision {currentPlan.revisionNumber} steps
          </h4>
          <ol className="space-y-1">
            {currentPlan.steps.map((step) => (
              <li key={step.order} className="text-xs text-emerald-100/70">
                {step.order}. {step.summary}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {response.replanJobId ? (
        <p className="mt-3 font-mono text-[11px] text-emerald-100/35">
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
    <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] p-3">
      <p className="text-xs font-medium text-emerald-200/80">{programName}</p>
      {replayed ? (
        <p className="mt-1 text-xs text-emerald-100/40">
          Unchanged (idempotent replay)
        </p>
      ) : (
        <p className="mt-1 font-mono text-xs text-emerald-100/70">
          v1 →{" "}
          <span className="font-semibold text-emerald-200">v2</span>
          {amount ? (
            <span className="ml-2 text-emerald-100/55">
              ({deduction ? "−" : "+"}
              {formatPoints(amount)} pts)
            </span>
          ) : null}
        </p>
      )}
    </div>
  );
}
