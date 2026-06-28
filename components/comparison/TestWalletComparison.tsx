"use client";

import { useMemo, useState } from "react";

import type {
  ArchitectureComparisonResponse,
  ArchitectureVariant,
  DemoSimulateTransferResponse,
  PublicBalance,
  PublicWalletFacts,
} from "@/lib/comparison/types";
import { ArchitectureResultCard, type CardState } from "./ArchitectureResultCard";
import { WalletFactsPanel } from "./WalletFactsPanel";

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
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [simulateError, setSimulateError] = useState<string | null>(null);

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

  async function runComparison() {
    if (!facts) return;
    setPhase("running");
    setSimulatePhase("idle");
    setResponse(null);
    setSimulateResponse(null);
    setBalanceOverrides(null);
    setIdempotencyKey(null);
    setErrorMessage(null);
    setSimulateError(null);
    try {
      const res = await fetch("/api/demo/architecture-comparison", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletId: facts.walletId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      setResponse((await res.json()) as ArchitectureComparisonResponse);
      setPhase("done");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Comparison failed.");
      setPhase("error");
    }
  }

  async function simulateTransfer() {
    if (!facts || !graphReady) return;
    setSimulatePhase("running");
    setSimulateError(null);
    const key = idempotencyKey ?? crypto.randomUUID();
    if (!idempotencyKey) setIdempotencyKey(key);

    try {
      const res = await fetch("/api/demo/simulate-transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletId: facts.walletId, idempotencyKey: key }),
      });
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
      setSimulateError(error instanceof Error ? error.message : "Transfer simulation failed.");
      setSimulatePhase("error");
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
                setPhase("idle");
                setSimulatePhase("idle");
                setResponse(null);
                setSimulateResponse(null);
                setBalanceOverrides(null);
                setIdempotencyKey(null);
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

      <WalletFactsPanel facts={facts} />

      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={runComparison}
          disabled={phase === "running"}
          className="rounded-full bg-indigo-400 px-6 py-2.5 text-sm font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {phase === "running" ? "Running all three…" : "Run comparison"}
        </button>

        <button
          onClick={simulateTransfer}
          disabled={!graphReady || simulatePhase === "running"}
          title={graphReady ? "Apply the canonical Chase→Hyatt transfer and replan" : "Run the comparison first"}
          className="rounded-full border border-white/20 px-6 py-2.5 text-sm font-semibold text-white transition hover:border-white/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {simulatePhase === "running"
            ? "Simulating transfer…"
            : simulateResponse?.idempotencyReplayed
              ? "Repeat transfer (idempotent replay)"
              : "Simulate completed transfer"}
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

      <div className="grid gap-4 lg:grid-cols-3">
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
      className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm text-emerald-100"
      aria-live="polite"
    >
      <p className="font-semibold text-emerald-200">
        {idempotencyReplayed
          ? "Idempotent replay detected — revision 2 remains current."
          : `Revision ${currentPlan.revisionNumber} is now current (revision 1 superseded).`}
      </p>
      <ul className="mt-2 space-y-1 text-emerald-100/90">
        <li>
          Transfer applied: {formatPoints(transfer.amountPoints)} pts Chase → Hyatt
          {idempotencyReplayed ? " (replay — balances unchanged)" : ""}
        </li>
        <li>
          Plan status: {currentPlan.status} · revision {currentPlan.revisionNumber}
        </li>
        <li>
          Transfer step in revision {currentPlan.revisionNumber}:{" "}
          {hasTransferStep ? "still present" : "removed"}
        </li>
        {response.replanJobId ? <li>Replan job: {response.replanJobId.slice(0, 8)}…</li> : null}
      </ul>
    </div>
  );
}

function formatPoints(value: number): string {
  return value.toLocaleString("en-US");
}
