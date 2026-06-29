"use client";

import type { ArchitectureRunStatus } from "@/lib/comparison/types";

/**
 * Conceptual execution view — how each architecture coordinates internally,
 * and where they converge.
 *
 * Labeled "Conceptual execution view" because it represents coordination
 * patterns, not a live event trace. Lane statuses are driven from real
 * request lifecycle state (idle/running/done/failed) via props.
 *
 * Accessibility: each lane has a text equivalent describing the coordination
 * model. The diagram is aria-hidden; the prose description is visible.
 */

export interface LaneStatus {
  graph: ArchitectureRunStatus;
  chat: ArchitectureRunStatus;
  single: ArchitectureRunStatus;
}

interface Props {
  laneStatus: LaneStatus;
}

const GRAPH_STEPS = [
  { id: "wallet-specialist", label: "Wallet Specialist", detail: "reads balances + transfer routes" },
  { id: "typed-graph", label: "Typed graph state", detail: "versioned nodes + edges", isShared: true },
  { id: "redemption-specialist", label: "Redemption Specialist", detail: "reads graph, selects award" },
  { id: "persisted-plan", label: "Persisted Plan", detail: "revision 1 committed to DB" },
];

const CHAT_STEPS = [
  { id: "wallet-agent", label: "Wallet Agent", detail: "reads balances" },
  { id: "natural-handoff", label: "Natural-language handoff", detail: "balance summary in prose", isShared: true },
  { id: "redemption-agent", label: "Redemption Agent", detail: "selects award from context" },
  { id: "generated-plan", label: "Generated Plan", detail: "plan in structured output" },
];

const SINGLE_STEPS = [
  { id: "combined-context", label: "Wallet + goal", detail: "all context in one prompt" },
  { id: "one-agent", label: "Single agent", detail: "one LLM call", isShared: true },
  { id: "plan-output", label: "Generated Plan", detail: "award + steps in structured output" },
];

function statusColor(status: ArchitectureRunStatus): string {
  switch (status) {
    case "running":
      return "border-indigo-400/60 bg-indigo-500/10";
    case "succeeded":
      return "border-emerald-500/40 bg-emerald-500/8";
    case "failed":
    case "timed_out":
      return "border-rose-500/40 bg-rose-500/8";
    default:
      return "border-white/10 bg-white/[0.03]";
  }
}

function statusDot(status: ArchitectureRunStatus): string {
  switch (status) {
    case "running":
      return "animate-pulse motion-reduce:animate-none bg-indigo-400";
    case "succeeded":
      return "bg-emerald-400";
    case "failed":
    case "timed_out":
      return "bg-rose-400";
    default:
      return "bg-white/20";
  }
}

function statusLabel(status: ArchitectureRunStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "succeeded":
      return "Completed";
    case "failed":
      return "Failed";
    case "timed_out":
      return "Timed out";
    default:
      return "Not started";
  }
}

interface Step {
  id: string;
  label: string;
  detail: string;
  isShared?: boolean;
}

function LaneSteps({ steps, running }: { steps: Step[]; running: boolean }) {
  return (
    <ol className="space-y-1.5" aria-label="Execution steps">
      {steps.map((step, i) => (
        <li key={step.id} className="flex items-start gap-2">
          <div className="mt-0.5 flex flex-col items-center">
            <div
              className={`h-5 w-5 rounded-full border text-center text-[10px] font-bold leading-[18px] ${
                step.isShared
                  ? "border-white/20 bg-white/10 text-white/60"
                  : "border-white/15 bg-white/5 text-white/50"
              }`}
            >
              {i + 1}
            </div>
            {i < steps.length - 1 ? (
              <div
                className={`mt-1 h-3 w-px ${running ? "bg-indigo-400/40" : "bg-white/10"}`}
                aria-hidden="true"
              />
            ) : null}
          </div>
          <div className="min-w-0">
            <div
              className={`text-xs font-medium ${
                step.isShared ? "text-white/70" : "text-white/85"
              }`}
            >
              {step.label}
            </div>
            <div className="text-[11px] text-white/40">{step.detail}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

interface LaneProps {
  title: string;
  tagline: string;
  steps: Step[];
  status: ArchitectureRunStatus;
  coordinationNote: string;
}

function Lane({ title, tagline, steps, status, coordinationNote }: LaneProps) {
  const running = status === "running";
  return (
    <div
      className={`flex flex-col rounded-xl border p-4 transition-colors duration-300 ${statusColor(status)}`}
      role="region"
      aria-label={`${title} execution lane`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          <p className="mt-0.5 text-[11px] text-white/45">{tagline}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`inline-block h-2 w-2 rounded-full ${statusDot(status)}`}
            aria-hidden="true"
          />
          <span className="text-[11px] text-white/50">{statusLabel(status)}</span>
        </div>
      </div>

      <LaneSteps steps={steps} running={running} />

      <p className="mt-3 text-[11px] text-white/35 italic">{coordinationNote}</p>
    </div>
  );
}

function EvaluatorNode() {
  return (
    <div
      className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-center"
      role="region"
      aria-label="Independent deterministic evaluator"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-amber-300/80">
        Independent evaluator
      </div>
      <div className="mt-1 text-[11px] text-white/45">
        Architecture-blind · deterministic · same rules for all three
      </div>
    </div>
  );
}

function ConvergenceArrow() {
  return (
    <div className="flex items-center justify-center py-1" aria-hidden="true">
      <div className="h-px flex-1 bg-white/10" />
      <div className="mx-2 text-white/20 text-xs">↓</div>
      <div className="h-px flex-1 bg-white/10" />
    </div>
  );
}

export function ArchitectureExecutionOverview({ laneStatus }: Props) {
  return (
    <section
      className="rounded-2xl border border-white/10 bg-white/[0.02] p-6"
      aria-label="Architecture execution overview"
    >
      <div className="mb-4">
        <h2 className="text-base font-semibold text-white">Conceptual execution view</h2>
        <p className="mt-1 text-sm text-white/50">
          The planners do not score themselves. Their outputs are converted to one normalized
          contract and evaluated by the same deterministic rules.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Lane
          title="Graph Crew"
          tagline="Specialists coordinate via typed shared graph state"
          steps={GRAPH_STEPS}
          status={laneStatus.graph}
          coordinationNote="Typed graph mutations — no free-text inter-agent messages"
        />
        <Lane
          title="Chat Crew"
          tagline="Agents coordinate via structured natural-language handoffs"
          steps={CHAT_STEPS}
          status={laneStatus.chat}
          coordinationNote="Safe summaries of explicit handoffs shown — no hidden reasoning"
        />
        <Lane
          title="Single Agent"
          tagline="One LLM call with full context"
          steps={SINGLE_STEPS}
          status={laneStatus.single}
          coordinationNote="Simplest coordination model — no specialist boundaries"
        />
      </div>

      <ConvergenceArrow />

      <div className="mt-1 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-center text-xs text-white/50">
        Normalized Plan Contract — same fields, same order, same schema for all three
      </div>

      <ConvergenceArrow />

      <EvaluatorNode />
    </section>
  );
}
