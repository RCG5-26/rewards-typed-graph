"use client";

import type {
  ActivityEntry,
  ActivityPhase,
  AgentActivityTrace,
  PlanLifecycleEntry,
  SpecialistRunEntry,
} from "@/lib/plan/activity";
import { specialistLabel } from "@/lib/plan/activity";

/**
 * Compact agent-activity panel — the demo-observability hero visual.
 *
 * Renders the orchestration-evidence trace as an ordered list: each specialist
 * run (specialist · operation · snapshot version · commit) and each Plan-revision
 * lifecycle transition, in execution order. It is a pure projection of its
 * `trace` prop — no fetching, no SSE, no backend coupling. `AgentActivityLive`
 * wires it to the real `/api/mutations/stream`; callers may also pass any
 * `AgentActivityTrace` directly.
 *
 * Accessibility:
 *  - `<ol>` conveys operation order without relying on visual position.
 *  - Lifecycle state is carried by a shape-distinct glyph **and** visually-hidden
 *    text — never by color alone (WCAG 1.4.1).
 *  - The list region is a labelled, focusable group, polite-live so streamed
 *    appends are announced without stealing focus.
 *  - No animation is required for correctness.
 */

const TITLE_DEFAULT = "Agent activity";

/** Shape-distinct glyph + screen-reader word + design-token color per state. */
interface Tone {
  readonly glyph: string;
  readonly srWord: string;
  readonly color: string;
  readonly bg: string;
}

const TONE: Record<"succeeded" | "running" | "pending" | "failed" | "stale", Tone> = {
  succeeded: { glyph: "✓", srWord: "succeeded", color: "var(--status-current)", bg: "var(--status-current-bg)" },
  running: { glyph: "◷", srWord: "running", color: "var(--status-generating)", bg: "var(--status-generating-bg)" },
  pending: { glyph: "·", srWord: "pending", color: "var(--status-proposed)", bg: "var(--status-proposed-bg)" },
  failed: { glyph: "✕", srWord: "failed", color: "var(--status-failed)", bg: "var(--status-failed-bg)" },
  stale: { glyph: "!", srWord: "needs attention", color: "var(--status-stale)", bg: "var(--status-stale-bg)" },
};

/** Map an entry to its tone — stale/superseded lifecycle reads as a warning, not a failure. */
function toneFor(entry: ActivityEntry): Tone {
  if (entry.status === "failed") return TONE.failed;
  if (entry.status === "running") return TONE.running;
  if (entry.status === "pending") return TONE.pending;
  if (entry.kind === "plan_lifecycle" && (entry.transition === "stale" || entry.transition === "superseded")) {
    return TONE.stale;
  }
  return TONE.succeeded;
}

function commitLine(commit: SpecialistRunEntry["commit"]): string | null {
  if (!commit) return null;
  if (commit.result === "committed") {
    return commit.idempotencyReplayed ? "Commit replayed (idempotent)" : "Commit recorded";
  }
  return `Commit failed: ${commit.failureClass}`;
}

/** Secondary evidence lines under a specialist run (snapshot, validation, commit, detail). */
function specialistSubLines(entry: SpecialistRunEntry): string[] {
  const lines: string[] = [];
  if (entry.snapshotVersion) lines.push(`Snapshot: ${entry.snapshotVersion}`);
  if (entry.validation && entry.validation !== "not_run") {
    lines.push(`Validation: ${entry.validation}`);
  }
  const commit = commitLine(entry.commit);
  if (commit) lines.push(commit);
  if (entry.detail) lines.push(entry.detail);
  return lines;
}

const TRANSITION_VERB: Record<PlanLifecycleEntry["transition"], string> = {
  committed: "committed",
  promoted: "promoted",
  stale: "marked stale",
  superseded: "superseded",
  failed: "failed",
};

function StatusGlyph({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold leading-none"
      style={{ color: tone.color, background: tone.bg }}
    >
      {tone.glyph}
    </span>
  );
}

function EntryRow({ entry }: { entry: ActivityEntry }) {
  const tone = toneFor(entry);

  if (entry.kind === "specialist_run") {
    const title = `${specialistLabel(entry.specialist)} · ${entry.operationLabel ?? entry.operation}`;
    const subLines = specialistSubLines(entry);
    return (
      <li className="flex gap-2.5 py-1.5">
        <StatusGlyph tone={tone} />
        <div className="min-w-0">
          <p className="text-[13px] font-medium leading-tight text-[var(--color-neutral-900,#1c1c22)]">
            <span className="sr-only">{tone.srWord}: </span>
            {title}
          </p>
          {subLines.map((line) => (
            <p key={line} className="text-[12px] leading-snug text-[var(--color-neutral-600,#5a6072)]">
              {line}
            </p>
          ))}
        </div>
      </li>
    );
  }

  // plan_lifecycle
  return (
    <li className="flex gap-2.5 py-1.5">
      <StatusGlyph tone={tone} />
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-tight text-[var(--color-neutral-900,#1c1c22)]">
          <span className="sr-only">{tone.srWord}: </span>
          Plan revision {entry.revision} {TRANSITION_VERB[entry.transition]}
        </p>
        {entry.reason ? (
          <p className="text-[12px] leading-snug text-[var(--color-neutral-600,#5a6072)]">{entry.reason}</p>
        ) : null}
        {entry.detail ? (
          <p className="text-[12px] leading-snug text-[var(--color-neutral-600,#5a6072)]">{entry.detail}</p>
        ) : null}
      </div>
    </li>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      className="rounded-xl border border-[var(--color-neutral-200,#e6e8ee)] bg-[var(--color-surface,#fff)] p-3.5"
    >
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-neutral-500,#8a93a6)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

export interface AgentActivityProps {
  /** The orchestration-evidence trace to render. */
  trace?: AgentActivityTrace | null;
  /** Load state of the trace source. Defaults to "ready". */
  phase?: ActivityPhase;
  /** Message shown in the "error" phase. */
  error?: string;
  /** Heading text. */
  title?: string;
}

export default function AgentActivity({
  trace,
  phase = "ready",
  error,
  title = TITLE_DEFAULT,
}: AgentActivityProps) {
  if (phase === "loading") {
    return (
      <Shell title={title}>
        <p role="status" className="text-[13px] text-[var(--color-neutral-500,#8a93a6)]">
          Loading agent activity…
        </p>
      </Shell>
    );
  }

  if (phase === "error") {
    return (
      <Shell title={title}>
        <p role="alert" className="text-[13px] text-[var(--status-failed,#c0392b)]">
          {error ?? "Could not load agent activity."}
        </p>
      </Shell>
    );
  }

  const entries = trace?.entries ?? [];
  if (entries.length === 0) {
    return (
      <Shell title={title}>
        <p className="text-[13px] text-[var(--color-neutral-500,#8a93a6)]">No agent activity yet.</p>
      </Shell>
    );
  }

  return (
    <Shell title={title}>
      <ol
        // Focusable, labelled live region: keyboard users can reach/scroll it and
        // streamed appends are announced politely.
        tabIndex={0}
        aria-live="polite"
        aria-label={`${title}, ${entries.length} ${entries.length === 1 ? "event" : "events"} in order`}
        className="m-0 max-h-[420px] list-none overflow-y-auto p-0 outline-none focus-visible:ring-2 focus-visible:ring-[var(--status-current,#5b5bd6)]"
      >
        {entries.map((entry, i) => (
          <EntryRow key={entry.kind === "specialist_run" ? entry.runId : `rev-${entry.revision}-${entry.transition}-${i}`} entry={entry} />
        ))}
      </ol>
    </Shell>
  );
}
