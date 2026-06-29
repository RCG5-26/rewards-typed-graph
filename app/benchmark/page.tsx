import BackLink from "@/components/BackLink";
import BenchmarkView from "@/components/onboarding/BenchmarkView";

/**
 * /benchmark — Benchmark & Evidence.
 *
 * Two deliberately separate evidence types:
 *  1. The 30-case architecture benchmark — a fixture-backed quantitative
 *     evaluation rendered from a versioned artifact (`BenchmarkView` reads
 *     `lib/benchmark/architecture-comparison.json`). Nothing is hard-coded.
 *  2. Live orchestrator hero-scenario evidence — the PostgreSQL-backed
 *     structural invalidation/replan lifecycle, demonstrated live on the
 *     comparison page. This is structural evidence, NOT 30-case accuracy; the
 *     two are never conflated.
 *
 * Shares the onboarding/comparison dark lane so the demo feels like one product.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HERO_EVIDENCE_STEPS = [
  "Revision 1 created — the graph orchestrator plans against the live persona snapshot.",
  "Mutation applied — a 15,000-point Chase → Hyatt transfer writes new balances.",
  "Balance versions updated — affected user_balances rows bump their integer version.",
  "Revision 1 invalidated — the plan step depending on the stale Hyatt balance goes stale.",
  "Specialists reran — fresh Wallet and Redemption AgentRuns execute.",
  "Revision 2 current — the new revision supersedes revision 1.",
  "Idempotent replay — re-applying the same transfer leaves balances and the revision unchanged.",
] as const;

export default function BenchmarkPage() {
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
        <div className="mb-6">
          <BackLink href="/test-wallets">back to live comparison</BackLink>
        </div>

        <header className="mb-8">
          <div className="font-mono text-2xs font-semibold uppercase tracking-[0.18em] text-accent-text">
            evidence
          </div>
          <h1 className="mt-2 font-display text-3xl font-light leading-[1.08] tracking-snug text-text-primary">
            Benchmark &amp; Evidence
          </h1>
          <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-text-secondary">
            Two separate kinds of evidence: a fixture-backed quantitative benchmark across 30 cases,
            and the live PostgreSQL-backed structural replanning behavior. They measure different
            things and are reported separately.
          </p>
        </header>

        {/* ── Section 1: 30-case architecture benchmark (precomputed artifact) ── */}
        <section className="mb-10" aria-labelledby="benchmark-30">
          <div className="mb-3">
            <h2
              id="benchmark-30"
              className="font-display text-xl font-light tracking-snug text-text-primary"
            >
              30-case architecture benchmark
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Fixture-backed quantitative evaluation. Read from a versioned artifact — accuracy,
              hallucinated ratios, and invalidations caught, with the evaluator version and capture
              timestamp shown inline.
            </p>
          </div>
          {/* BenchmarkView's root uses flex-1; give it a sized flex parent so the
              scrollable metric region resolves to a real height. */}
          <div className="flex min-h-[560px] flex-col">
            <BenchmarkView />
          </div>
        </section>

        {/* ── Section 2: live orchestrator hero-scenario evidence (structural) ── */}
        <section aria-labelledby="benchmark-hero">
          <div className="mb-3">
            <h2
              id="benchmark-hero"
              className="font-display text-xl font-light tracking-snug text-text-primary"
            >
              Live orchestrator hero-scenario evidence
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              One canonical PostgreSQL-backed scenario: structural invalidation and replanning.
            </p>
          </div>

          <div className="rounded-card border border-subtle bg-surface p-6">
            <ol className="space-y-2.5">
              {HERO_EVIDENCE_STEPS.map((step, i) => (
                <li key={step} className="flex gap-3 text-sm text-text-secondary">
                  <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-surface-subtle font-mono text-2xs text-text-tertiary tabular-nums">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>

            <div
              className="mt-5 rounded-lg px-4 py-3 text-xs leading-relaxed"
              style={{
                background: "color-mix(in srgb, var(--color-warning) 12%, transparent)",
                color: "var(--color-text-secondary)",
                border: "1px solid color-mix(in srgb, var(--color-warning) 24%, transparent)",
              }}
            >
              This is structural hero-scenario evidence — it demonstrates that a state change
              invalidates the dependent Plan and triggers a fresh, correct re-plan. It is{" "}
              <strong className="text-text-primary">not</strong> 30-case accuracy. Run it live on the
              Live Planner Comparison page to watch revision 2 become current.
            </div>
          </div>

          <div className="mt-6">
            <BackLink href="/test-wallets">back to live comparison</BackLink>
          </div>
        </section>
      </div>
    </main>
  );
}
