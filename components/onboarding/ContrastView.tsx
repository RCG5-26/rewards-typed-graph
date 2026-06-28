"use client";

import { benchmarkReport, isMeasured, pct } from "@/lib/benchmark/report";

/**
 * Head-to-head contrast — the same gold suite scored across three architectures.
 * Driven entirely by the **captured real** benchmark report
 * (`lib/benchmark/architecture-comparison.json`). The typed-graph column shows
 * live-scored metrics; LLM-baseline columns show `not run` with the command to
 * produce them. No fabricated values, no invented failure narrative.
 */

const ACCENT: Record<string, { accent: string; border: string }> = {
  typed_graph_fixture: { accent: "var(--color-accent)", border: "var(--color-accent-subtle)" },
  free_text_multiagent_baseline: { accent: "var(--color-warning)", border: "var(--color-warning-bg)" },
  single_agent_llm_baseline: { accent: "var(--color-neutral-500)", border: "var(--color-border)" },
};

export default function ContrastView() {
  const { architectures, caseCount, benchmarkId, generatedAt } = benchmarkReport;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 text-xs text-text-secondary">
        same {caseCount}-case gold suite, scored across three architectures — only the typed graph
        keeps a typed shared state.
      </div>
      <div className="flex min-h-0 flex-1 gap-3">
        {architectures.map((c) => {
          const accent = ACCENT[c.key] ?? ACCENT.single_agent_llm_baseline;
          return (
            <div
              key={c.key}
              className="flex min-w-0 flex-1 flex-col rounded-card bg-surface p-5 shadow-raised"
              style={{ border: `1px solid ${accent.border}` }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: accent.accent }} />
                  <span className="font-display text-base font-semibold text-text-primary">
                    {c.label}
                  </span>
                </div>
                <span
                  className="rounded font-mono text-[10px] font-semibold uppercase tracking-wide"
                  style={
                    isMeasured(c)
                      ? { background: "var(--color-accent-muted)", color: "var(--color-accent-text)", padding: "2px 7px" }
                      : { background: "var(--color-surface-subtle)", color: "var(--color-text-tertiary)", padding: "2px 7px" }
                  }
                >
                  {isMeasured(c) ? "measured" : "not run"}
                </span>
              </div>
              <div className="my-3.5 h-px" style={{ background: "var(--color-border)" }} />

              {isMeasured(c) ? (
                <div className="flex flex-1 flex-col gap-3.5">
                  <Metric label="Plan accuracy" value={`${pct(c.accuracyRate)} · ${c.accuracyPassed}/${c.accuracyTotal}`} />
                  <Metric label="Hallucinated ratios" value={`${c.hallucinationCount} · ${pct(c.hallucinationRate)}`} />
                  <Metric
                    label="Invalidations caught"
                    value={`${pct(c.invalidationRate)} · ${c.invalidationPassed}/${c.invalidationTotal}`}
                  />
                  <Metric
                    label="Token cost"
                    value={c.tokenCostTotal == null ? "not instrumented" : `${c.tokenCostTotal.toLocaleString()} tok`}
                    muted={c.tokenCostTotal == null}
                  />
                </div>
              ) : (
                <div className="flex flex-1 flex-col justify-between gap-3">
                  <p className="text-[13px] leading-snug text-text-secondary">
                    Not yet scored — this LLM baseline needs a paid key. Run it, then regenerate the
                    report:
                  </p>
                  <code className="block overflow-x-auto rounded-lg p-2.5 font-mono text-2xs text-text-secondary" style={{ background: "var(--color-surface-subtle)" }}>
                    {c.run}
                  </code>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-2 font-mono text-2xs text-text-tertiary">
        {benchmarkId} · captured {generatedAt} · real scorer output (no fabricated baselines)
      </div>
    </div>
  );
}

function Metric({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-subtle pb-3 last:border-0">
      <span className="font-mono text-2xs font-semibold uppercase tracking-wide text-text-tertiary">
        {label}
      </span>
      <span
        className="font-display text-lg font-semibold tabular-nums"
        style={{ color: muted ? "var(--color-text-tertiary)" : "var(--color-success-fg)" }}
      >
        {value}
      </span>
    </div>
  );
}
