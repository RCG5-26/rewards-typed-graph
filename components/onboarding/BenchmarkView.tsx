"use client";

/**
 * Benchmark view (RCG-46): accuracy / hallucination / invalidation / token-cost
 * bars across the three architectures. Illustrative demo fixtures — clearly
 * labelled, not a live eval run.
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
}
interface Row {
  label: string;
  hint: string;
  cells: Cell[];
}

const ROWS: Row[] = [
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
  {
    label: "Invalidations caught",
    hint: "higher is better",
    cells: [
      { arch: "Typed graph", val: "96%", barPct: 96, color: "var(--color-accent)" },
      { arch: "CrewAI", val: "22%", barPct: 22, color: "var(--color-warning)" },
      { arch: "Single agent", val: "9%", barPct: 9, color: "var(--color-neutral-400)" },
    ],
  },
  {
    label: "Token cost / query",
    hint: "lower is better",
    cells: [
      { arch: "Typed graph", val: "4.2k", barPct: 36, color: "var(--color-accent)" },
      { arch: "CrewAI", val: "11.8k", barPct: 100, color: "var(--color-error)" },
      { arch: "Single agent", val: "8.5k", barPct: 72, color: "var(--color-neutral-400)" },
    ],
  },
];

export default function BenchmarkView() {
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
        illustrative demo fixtures · Evaluation-node typed columns
      </div>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {ROWS.map((row) => (
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
                  <span className="w-14 flex-none text-right font-mono text-xs font-semibold text-text-primary tabular-nums">
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
