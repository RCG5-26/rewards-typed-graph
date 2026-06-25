"use client";

/**
 * Head-to-head contrast (Hero Moment 3): the same query, wallet, and tools run
 * across three architectures — typed graph vs. two baselines — where the
 * baselines visibly fail (hallucinate a ratio, miss the invalidation, re-fetch
 * tool results). Numbers are illustrative demo fixtures, not a live benchmark
 * (that's the benchmark view). Derived from the live plan so the typed column's
 * value matches what just streamed.
 */

const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

type Mark = "ok" | "bad" | "warn";

const MARK_STYLE: Record<Mark, { bg: string; color: string; glyph: string }> = {
  ok: { bg: "var(--color-success-bg)", color: "var(--color-success-fg)", glyph: "✓" },
  bad: { bg: "var(--color-error-bg)", color: "var(--color-error-fg)", glyph: "✗" },
  warn: { bg: "var(--color-warning-bg)", color: "var(--color-warning-fg)", glyph: "!" },
};

export default function ContrastView({
  planValueCents,
}: {
  planValueCents: number;
}) {
  const columns = [
    {
      key: "typed",
      title: "Typed graph",
      tag: "shared typed state",
      accent: "var(--color-accent)",
      border: "var(--color-accent-subtle)",
      lines: [
        { mark: "ok" as Mark, t: "Read the Chase→Hyatt ratio from the graph: 1:1 (correct)." },
        { mark: "ok" as Mark, t: "Caught the balance invalidation and re-planned to the next award." },
        { mark: "ok" as Mark, t: "No tool result re-fetched — coordination is state, not messages." },
      ],
      metricLabel: "plan value",
      metricValue: dollars(planValueCents),
      metricColor: "var(--color-success-fg)",
      tokens: "4.2k tok",
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
      metricValue: `${dollars(Math.round(planValueCents * 1.25))}*`,
      metricColor: "var(--color-error-fg)",
      tokens: "11.8k tok",
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
      metricValue: dollars(Math.round(planValueCents * 0.7)),
      metricColor: "var(--color-warning-fg)",
      tokens: "8.5k tok",
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
        * hallucinated — the baseline overstates value on a ratio it never verified.
      </div>
    </div>
  );
}
