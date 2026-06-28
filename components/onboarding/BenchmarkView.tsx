"use client";

import { benchmarkReport, isMeasured, pct, type ReportArchitecture } from "@/lib/benchmark/report";

/**
 * Benchmark view — renders the **captured real** architecture-comparison report
 * (`lib/benchmark/architecture-comparison.json`, produced by
 * `scripts/build_benchmark_report.py`). The typed-graph column is scored live
 * against the 30-case gold suite; LLM baselines show `not run` until their report
 * files exist (they need a paid key). No fabricated constants.
 */

const ARCH_COLOR: Record<string, string> = {
  typed_graph_fixture: "var(--color-accent)",
  free_text_multiagent_baseline: "var(--color-warning)",
  single_agent_llm_baseline: "var(--color-neutral-400)",
};

type Measured = Extract<ReportArchitecture, { status: "measured" }>;

interface MetricRow {
  label: string;
  hint: string;
  value: (a: Measured) => string;
  /** Bar fill 0..100. */
  bar: (a: Measured) => number;
}

const ROWS: MetricRow[] = [
  {
    label: "Plan accuracy",
    hint: "higher is better",
    value: (a) => `${pct(a.accuracyRate)} (${a.accuracyPassed}/${a.accuracyTotal})`,
    bar: (a) => a.accuracyRate * 100,
  },
  {
    label: "Hallucinated ratios",
    hint: "lower is better",
    value: (a) => `${a.hallucinationCount} (${pct(a.hallucinationRate)})`,
    bar: (a) => a.hallucinationRate * 100,
  },
  {
    label: "Invalidations caught",
    hint: "higher is better",
    value: (a) => `${pct(a.invalidationRate)} (${a.invalidationPassed}/${a.invalidationTotal})`,
    bar: (a) => a.invalidationRate * 100,
  },
];

export default function BenchmarkView() {
  const { architectures, caseCount, generatedAt, benchmarkId } = benchmarkReport;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-surface p-6 shadow-raised">
      <div className="flex items-center justify-between">
        <div className="font-display text-sm font-semibold uppercase tracking-wide text-text-primary">
          benchmark · {caseCount}-case gold suite
        </div>
        <div className="flex flex-wrap gap-4">
          {architectures.map((a) => (
            <div key={a.key} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: ARCH_COLOR[a.key] }} />
              <span className="text-xs text-text-secondary">{a.label}</span>
              {a.status === "not_run" && (
                <span className="font-mono text-2xs text-text-tertiary">(not run)</span>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mb-5 mt-1 font-mono text-2xs text-text-tertiary">
        {benchmarkId} · captured {generatedAt} · typed scored live; LLM baselines need a paid key
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {ROWS.map((row) => (
          <div key={row.label}>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[13px] font-semibold text-text-primary">{row.label}</span>
              <span className="font-mono text-2xs text-text-tertiary">{row.hint}</span>
            </div>
            <div className="flex flex-col gap-2">
              {architectures.map((a) => (
                <div key={a.key} className="flex items-center gap-3">
                  <span className="w-24 flex-none text-xs text-text-tertiary">{a.label}</span>
                  <div className="relative h-[18px] flex-1 overflow-hidden rounded-sm bg-surface-subtle">
                    {isMeasured(a) && (
                      <div
                        className="absolute left-0 top-0 h-full rounded-sm transition-[width] duration-slow ease-spring-snappy"
                        style={{ width: `${row.bar(a)}%`, background: ARCH_COLOR[a.key] }}
                      />
                    )}
                  </div>
                  <span className="flex w-28 flex-none items-center justify-end gap-1 text-right font-mono text-xs font-semibold text-text-primary tabular-nums">
                    {isMeasured(a) ? (
                      <>
                        <span
                          className="h-1 w-1 flex-none rounded-full"
                          style={{ background: "var(--color-accent)" }}
                          aria-label="measured"
                        />
                        {row.value(a)}
                      </>
                    ) : (
                      <span className="text-text-tertiary">not run</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 font-mono text-2xs leading-relaxed text-text-tertiary">
        Token cost/query is omitted — it needs LLM-in-loop + `agent_runs.token_count` (deferred). To
        fill the baselines: run the commands in the report, then{" "}
        <span className="text-text-secondary">python scripts/build_benchmark_report.py</span>.
      </div>
    </div>
  );
}
