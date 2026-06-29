import BackLink from "@/components/BackLink";
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

  // Shares the onboarding dark lane: data-theme="dark" remaps the design tokens,
  // and the radial gradient + drifting dot-grid + iris blob match the onboarding
  // shell so the demo entry point feels like the same product, not a separate UI.
  return (
    <main
      data-theme="dark"
      className="relative min-h-screen overflow-hidden bg-surface-subtle text-text-primary"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 72% 18%, #14171f 0%, var(--color-bg-elevated) 38%, var(--color-bg) 78%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          WebkitMaskImage: "radial-gradient(ellipse 78% 78% at 42% 38%, black, transparent 100%)",
          maskImage: "radial-gradient(ellipse 78% 78% at 42% 38%, black, transparent 100%)",
          animation: "gp-grid-drift 60s linear infinite",
        }}
      />
      <div
        className="pointer-events-none absolute -left-40 -top-40 h-[460px] w-[460px] rounded-full"
        style={{ background: "var(--blob-glow-lg)", opacity: 0.4 }}
      />

      <div className="relative z-[2] mx-auto max-w-6xl px-6 py-12">
        {/* Closes the dead-end: this page is reached from the plan's
            "head-to-head comparison →" link, so it returns to onboarding. */}
        <div className="mb-6">
          <BackLink href="/onboarding">back to onboarding</BackLink>
        </div>
        <header className="mb-8">
          <div className="font-mono text-2xs font-semibold uppercase tracking-[0.18em] text-accent-text">
            architecture comparison
          </div>
          <h1 className="mt-2 font-display text-3xl font-light leading-[1.08] tracking-snug text-text-primary">
            Test wallets
          </h1>
          <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-text-secondary">
            One canonical wallet, one query, three architectures run independently and scored by the
            same deterministic evaluator. Inspect the wallet below, then run the comparison.
          </p>
        </header>

        {loadError ? (
          <div
            className="rounded-card p-4 text-sm"
            style={{
              background: "var(--color-error-bg)",
              color: "var(--color-error-fg)",
              border: "1px solid color-mix(in srgb, var(--color-error) 24%, transparent)",
            }}
          >
            {loadError}
          </div>
        ) : (
          <TestWalletComparison wallets={wallets} />
        )}
      </div>
    </main>
  );
}
