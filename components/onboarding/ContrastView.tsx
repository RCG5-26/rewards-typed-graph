"use client";

import {
  deriveComparison,
  fmtTokens,
  type LiveMetrics,
} from "@/lib/plan/comparison";

/**
 * Head-to-head contrast (Hero Moment 3): the same query, wallet, and tools run
 * across three architectures — typed graph vs. two baselines — where the
 * baselines visibly fail (hallucinate a ratio, miss the invalidation, re-fetch
 * tool results).
 *
 * Driven by the *live* plan run: the typed column's value and every token count
 * come from the real streamed plan (`lib/plan/comparison.ts`), and the typed
 * "caught the invalidation" line reflects whether a re-plan actually fired this
 * session. The baseline value/token figures are derived from those live numbers
 * via the documented model — illustrative projections, not a real CrewAI run.
 */

const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

type Mark = "ok" | "bad" | "warn";

const MARK_STYLE: Record<Mark, { bg: string; color: string; glyph: string }> = {
  ok: { bg: "var(--color-success-bg)", color: "var(--color-success-fg)", glyph: "✓" },
  bad: { bg: "var(--color-error-bg)", color: "var(--color-error-fg)", glyph: "✗" },
  warn: { bg: "var(--color-warning-bg)", color: "var(--color-warning-fg)", glyph: "!" },
};

export default function ContrastView({ metrics }: { metrics: LiveMetrics }) {
  const cmp = deriveComparison(metrics);
  const caught = metrics.invalidationCaught;

  const columns = [
    {
      key: "typed",
      title: "Typed graph",
      tag: "shared typed state",
      accent: "var(--color-accent)",
      border: "var(--color-accent-subtle)",
      lines: [
        { mark: "ok" as Mark, t: "Read the Chase→Hyatt ratio from the graph: 1:1 (correct)." },
        caught
          ? {
              mark: "ok" as Mark,
              t: `Caught the balance invalidation and re-planned to the next award (revision ${metrics.revision}).`,
            }
          : {
              mark: "ok" as Mark,
              t: "Ready to catch a balance invalidation via typed state dependencies.",
            },
        { mark: "ok" as Mark, t: `${metrics.opCount} typed mutations — no tool result re-fetched; coordination is state, not messages.` },
      ],
      metricLabel: "plan value",
      metricValue: dollars(cmp.typed.valueCents),
      metricColor: "var(--color-success-fg)",
      tokens: `${fmtTokens(cmp.typed.tokens)} tok`,
    },
    {
      key: "crewai",
      title: "CrewAI (free-text)",
      tag: "json messages",
      accent: "var(--color-warning)",
      border: "var(--color-warning-bg)",
      lines: [
        { mark: "bad" as Mark, t: "Hallucinated a 1.25:1 transfer ratio — overstates the award value." },
        { mark: "bad" as Mark, t: "Missed the invalidation; committed a stale plan." },
        { mark: "warn" as Mark, t: "Passed the wallet as free-text JSON between agents." },
      ],
      metricLabel: "plan value",
      metricValue: `${dollars(cmp.crewai.valueCents)}*`,
      metricColor: "var(--color-error-fg)",
      tokens: `${fmtTokens(cmp.crewai.tokens)} tok`,
    },
    {
      key: "single",
      title: "Single agent",
      tag: "one context window",
      accent: "var(--color-neutral-500)",
      border: "var(--color-border)",
      lines: [
        { mark: "ok" as Mark, t: "Ratio correct on the first pass." },
        { mark: "bad" as Mark, t: "Re-fetched balances 3× — no shared state to read." },
        { mark: "bad" as Mark, t: "Lost the goal once the context window filled up." },
      ],
      metricLabel: "plan value",
      metricValue: dollars(cmp.single.valueCents),
      metricColor: "var(--color-warning-fg)",
      tokens: `${fmtTokens(cmp.single.tokens)} tok`,
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 text-xs text-text-secondary">
        same query, same wallet, same tools — three architectures. only one keeps a typed shared state.
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        {columns.map((c) => (
          <div
            key={c.key}
            className="flex min-w-0 flex-1 flex-col rounded-card bg-surface p-5 shadow-raised"
            style={{ border: `1px solid ${c.border}` }}
          >
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.accent }} />
              <span className="font-display text-base font-semibold text-text-primary">{c.title}</span>
            </div>
            <span className="mt-1.5 font-mono text-2xs text-text-tertiary">plan_type · {c.tag}</span>
            <div className="my-3.5 h-px" style={{ background: "var(--color-border)" }} />

            <div className="flex flex-1 flex-col gap-3">
              {c.lines.map((ln, i) => {
                const m = MARK_STYLE[ln.mark];
                return (
                  <div key={i} className="flex items-start gap-2.5">
                    <span
                      className="mt-0.5 flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[10px] font-bold"
                      style={{ background: m.bg, color: m.color }}
                    >
                      {m.glyph}
                    </span>
                    <span className="text-[13px] leading-snug text-text-secondary">{ln.t}</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex items-end justify-between border-t border-subtle pt-3.5">
              <div>
                <div className="font-mono text-2xs font-semibold uppercase tracking-wide text-text-tertiary">
                  {c.metricLabel}
                </div>
                <div className="mt-1 font-display text-2xl font-semibold tabular-nums" style={{ color: c.metricColor }}>
                  {c.metricValue}
                </div>
              </div>
              <span className="font-mono text-2xs text-text-tertiary">{c.tokens}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 font-mono text-2xs text-text-tertiary">
        value &amp; token counts derived live from {metrics.opCount} streamed mutations · * hallucinated baseline ratio.
      </div>
    </div>
  );
}
