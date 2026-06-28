"use client";

import { useMemo, useState } from "react";

import type {
  ArchitectureComparisonResponse,
  ArchitectureVariant,
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

/**
 * The Test Wallets vertical slice: inspect the canonical wallet, run all three
 * architectures with one click, and read the three independent results side by
 * side. Wallet tabs render from whatever public wallets the API exposes, so
 * adding wallets server-side lights up tabs here without UI changes.
 */
export function TestWalletComparison({ wallets }: { wallets: PublicWalletFacts[] }) {
  const [selectedWalletId, setSelectedWalletId] = useState(wallets[0]?.walletId ?? "");
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [response, setResponse] = useState<ArchitectureComparisonResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const facts = useMemo(
    () => wallets.find((w) => w.walletId === selectedWalletId) ?? wallets[0],
    [wallets, selectedWalletId],
  );

  async function runComparison() {
    if (!facts) return;
    setPhase("running");
    setResponse(null);
    setErrorMessage(null);
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
                setResponse(null);
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

        {/* Step 10: replan integration is gated on Person A. Disabled with no
            claim it works until "LIVE TYPESCRIPT REPLAN VERIFIED". */}
        <button
          disabled
          title="Available once live replan is verified"
          className="cursor-not-allowed rounded-full border border-white/10 px-6 py-2.5 text-sm text-white/30"
        >
          Simulate completed transfer (coming soon)
        </button>
      </div>

      {phase === "error" && errorMessage ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-200">
          {errorMessage}
        </div>
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
