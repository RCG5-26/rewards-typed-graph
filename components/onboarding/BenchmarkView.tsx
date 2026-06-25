"use client";

import {
  deriveComparison,
  fmtTokens,
  type LiveMetrics,
} from "@/lib/plan/comparison";

/**
 * Benchmark view (RCG-46): accuracy / hallucination / invalidation / token-cost
 * bars across the three architectures.
 *
 * The **token cost / query** row and the typed **invalidations caught** cell are
 * derived live from the current run (real streamed-mutation count + whether a
 * re-plan actually fired) via `lib/plan/comparison.ts`. The accuracy /
 * hallucination rates are cross-suite figures a single live run can't measure,
 * so they stay clearly-labelled illustrative fixtures.
 */

const ARCHS = [
  { key: "typed", name: "Typed graph", color: "var(--color-accent)" },
  { key: "crewai", name: "CrewAI", color: "var(--color-warning)" },
  { key: "single", name: "Single agent", color: "var(--color-neutral-500)" },
];

interface Cell {
  arch: string;
  val: string;
  barPct: number;
  color: string;
  /** Live-derived (vs. illustrative fixture) — flagged in the UI. */
  live?: boolean;
}
interface Row {
  label: string;
  hint: string;
  cells: Cell[];
}

export default function BenchmarkView({ metrics }: { metrics: LiveMetrics }) {
  const cmp = deriveComparison(metrics);

  // Token cost row, live: bars relative to the (highest) CrewAI cost.
  const maxTok = Math.max(cmp.typed.tokens, cmp.crewai.tokens, cmp.single.tokens, 1);
  const tokenRow: Row = {
    label: "Token cost / query",
    hint: "lower is better · live",
    cells: [
      { arch: "Typed graph", val: `${fmtTokens(cmp.typed.tokens)}`, barPct: Math.round((cmp.typed.tokens / maxTok) * 100), color: "var(--color-accent)", live: true },
      { arch: "CrewAI", val: `${fmtTokens(cmp.crewai.tokens)}`, barPct: Math.round((cmp.crewai.tokens / maxTok) * 100), color: "var(--color-error)", live: true },
      { arch: "Single agent", val: `${fmtTokens(cmp.single.tokens)}`, barPct: Math.round((cmp.single.tokens / maxTok) * 100), color: "var(--color-neutral-400)", live: true },
    ],
  };

  // Invalidations-caught: the typed cell is live only once a re-plan actually
  // fired this session; before that it's "—" (not yet observed), never a
  // precise score that would imply this run measured it.
  const typedCaught = metrics.invalidationCaught;
  const invalidationRow: Row = {
    label: "Invalidations caught",
    hint: typedCaught ? "higher is better · live" : "higher is better · run a replan",
    cells: [
      { arch: "Typed graph", val: typedCaught ? "100%" : "—", barPct: typedCaught ? 100 : 0, color: "var(--color-accent)", live: typedCaught },
      { arch: "CrewAI", val: "22%", barPct: 22, color: "var(--color-warning)" },
      { arch: "Single agent", val: "9%", barPct: 9, color: "var(--color-neutral-400)" },
    ],
  };

  const rows: Row[] = [
    {
      label: "Plan accuracy",
      hint: "higher is better",
      cells: [
        { arch: "Typed graph", val: "98%", barPct: 98, color: "var(--color-accent)" },
        { arch: "CrewAI", val: "71%", barPct: 71, color: "var(--color-warning)" },
        { arch: "Single agent", val: "64%", barPct: 64, color: "var(--color-neutral-400)" },
      ],
    },
    {
      label: "Hallucinated ratios",
      hint: "lower is better",
      cells: [
        { arch: "Typed graph", val: "1%", barPct: 6, color: "var(--color-accent)" },
        { arch: "CrewAI", val: "18%", barPct: 72, color: "var(--color-error)" },
        { arch: "Single agent", val: "12%", barPct: 48, color: "var(--color-neutral-400)" },
      ],
    },
    invalidationRow,
    tokenRow,
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card bg-surface p-6 shadow-raised">
      <div className="flex items-center justify-between">
        <div className="font-display text-sm font-semibold uppercase tracking-wide text-text-primary">
          benchmark · 30-query suite
        </div>
        <div className="flex gap-4">
          {ARCHS.map((a) => (
            <div key={a.key} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: a.color }} />
              <span className="text-xs text-text-secondary">{a.name}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="mb-5 mt-1 font-mono text-2xs text-text-tertiary">
        token cost &amp; typed invalidations live from this run · accuracy/hallucination illustrative fixtures
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[13px] font-semibold text-text-primary">{row.label}</span>
              <span className="font-mono text-2xs text-text-tertiary">{row.hint}</span>
            </div>
            <div className="flex flex-col gap-2">
              {row.cells.map((cell) => (
                <div key={cell.arch} className="flex items-center gap-3">
                  <span className="w-24 flex-none text-xs text-text-tertiary">{cell.arch}</span>
                  <div className="relative h-[18px] flex-1 overflow-hidden rounded-sm bg-surface-subtle">
                    <div
                      className="absolute left-0 top-0 h-full rounded-sm transition-[width] duration-slow ease-spring-snappy"
                      style={{ width: `${cell.barPct}%`, background: cell.color }}
                    />
                  </div>
                  <span className="flex w-16 flex-none items-center justify-end gap-1 text-right font-mono text-xs font-semibold text-text-primary tabular-nums">
                    {cell.live ? (
                      <span className="h-1 w-1 flex-none rounded-full" style={{ background: "var(--color-accent)" }} aria-label="live" />
                    ) : null}
                    {cell.val}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
