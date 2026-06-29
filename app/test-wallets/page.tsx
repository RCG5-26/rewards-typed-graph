import { TestWalletComparison } from "@/components/comparison/TestWalletComparison";
import { getTestWallets } from "@/lib/comparison/client";
import type { PublicWalletFacts } from "@/lib/comparison/types";

/**
 * /test-wallets — the demo entry point. Server-fetches the canonical public
 * wallet facts (so balances are never hard-coded in the client), then hands them
 * to the interactive comparison. Renders a graceful error if the API is down.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function TestWalletsPage() {
  let wallets: PublicWalletFacts[] = [];
  let loadError: string | null = null;
  try {
    wallets = (await getTestWallets()).wallets;
  } catch {
    loadError = "Could not load test wallets from the API. Is the Hono API running?";
  }

  // The comparison UI uses translucent white-on-dark cards. Paint a full-bleed
  // dark background here so contrast stays legible even though the app body is light.
  return (
    <main
      className="min-h-screen text-white"
      style={{
        background:
          "radial-gradient(120% 90% at 72% 18%, #14171f 0%, #0b0d12 38%, #06070a 78%)",
      }}
    >
      <div className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-8">
          <h1 className="font-display text-2xl tracking-tight text-white">
            Test Wallets — Architecture Comparison
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-white/70">
            One canonical wallet, one query, three architectures run independently and scored by the
            same deterministic evaluator. Inspect the wallet below, then run the comparison.
          </p>
        </header>

        {loadError ? (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm text-rose-200">
            {loadError}
          </div>
        ) : (
          <TestWalletComparison wallets={wallets} />
        )}
      </div>
    </main>
  );
}
