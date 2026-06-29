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

  // Styled with the Malleable UI design-system tokens so this route matches the
  // rest of the app's light surface — no bespoke dark background. Colors, radii,
  // and shadows all come from tokens via the Tailwind preset.
  return (
    <main className="min-h-screen bg-surface-subtle text-text-primary">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-8">
          <h1 className="font-display text-2xl tracking-tight text-text-primary">
            Test Wallets — Architecture Comparison
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-text-secondary">
            One canonical wallet, one query, three architectures run independently and
            scored by the same deterministic evaluator. Inspect the wallet below, then
            run the comparison.
          </p>
        </header>

        {loadError ? (
          <div className="rounded-card bg-[var(--color-error-bg)] p-4 text-sm text-[var(--color-error-fg)] ring-1 ring-[var(--color-error-200)]">
            {loadError}
          </div>
        ) : (
          <TestWalletComparison wallets={wallets} />
        )}
      </div>
    </main>
  );
}
