import type {
  ArchitectureComparisonResult,
  ArchitectureVariant,
  PublicWalletFacts,
} from "@/lib/comparison/types";
import { VARIANT_LABELS } from "@/lib/comparison/types";
import {
  actionLabel,
  evaluationChecks,
  formatLatency,
  formatPoints,
  programName,
} from "@/lib/comparison/presentation";

type CardState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "result"; result: ArchitectureComparisonResult };

export function ArchitectureResultCard({
  variant,
  facts,
  state,
}: {
  variant: ArchitectureVariant;
  facts: PublicWalletFacts;
  state: CardState;
}) {
  return (
    <article className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold text-white">{VARIANT_LABELS[variant]}</h3>
        <StatusBadge state={state} />
      </header>
      <Body variant={variant} facts={facts} state={state} />
    </article>
  );
}

function StatusBadge({ state }: { state: CardState }) {
  if (state.phase === "idle") {
    return <span className="text-xs text-white/65">Not started</span>;
  }
  if (state.phase === "loading") {
    return <span className="text-xs text-amber-300/80">Running…</span>;
  }
  const ok = state.result.status === "succeeded";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"
      }`}
    >
      {ok ? "Succeeded" : "Failed"}
    </span>
  );
}

function Body({
  variant,
  facts,
  state,
}: {
  variant: ArchitectureVariant;
  facts: PublicWalletFacts;
  state: CardState;
}) {
  if (state.phase === "idle") {
    return <p className="text-sm text-white/70">Run the comparison to see this architecture&apos;s plan.</p>;
  }
  if (state.phase === "loading") {
    return (
      <div className="space-y-2" aria-label="loading">
        <div className="h-3 w-3/4 animate-pulse rounded bg-white/10" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-white/10" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-white/10" />
      </div>
    );
  }

  const { result } = state;
  if (result.status !== "succeeded" || !result.plan) {
    return (
      <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
        <p className="text-sm text-rose-200">
          {result.error?.message ?? "This architecture did not return a plan."}
        </p>
        {result.error?.category ? (
          <p className="mt-1 font-mono text-xs text-rose-300/60">{result.error.category}</p>
        ) : null}
        <Metrics result={result} />
      </div>
    );
  }

  const { plan, evaluation } = result;
  return (
    <div className="space-y-4">
      <p className="text-sm text-white/80">{plan.summary}</p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-white/70">Selected award</dt>
        <dd className="text-right text-white/90">
          {plan.selectedAwardId
            ? plan.selectedAwardId.replace("award:", "")
            : "—"}
        </dd>
        <dt className="text-white/70">Transfer</dt>
        <dd className="text-right text-white/90">
          {plan.transferRequired ? `${formatPoints(plan.transferAmount)} pts` : "None"}
        </dd>
      </dl>

      {plan.steps.length > 0 ? (
        <ol className="space-y-1.5 border-l border-white/10 pl-3">
          {plan.steps.map((step) => (
            <li key={step.order} className="text-sm text-white/75">
              <span className="font-medium text-white/90">{actionLabel(step.actionType)}:</span>{" "}
              {step.title}
              {step.actionType === "transfer" && step.sourceProgramId ? (
                <span className="block text-xs text-white/65">
                  {programName(facts, step.sourceProgramId)} →{" "}
                  {programName(facts, step.destinationProgramId)}
                  {step.points !== undefined ? ` · ${formatPoints(step.points)} pts` : ""}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}

      {evaluation ? <EvaluationGrid checks={evaluation} /> : null}
      <Evidence result={result} />
      <Metrics result={result} />
    </div>
  );
}

function EvaluationGrid({ checks }: { checks: ArchitectureComparisonResult["evaluation"] }) {
  if (!checks) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-white/65">
        Independent evaluation
      </h4>
      <ul className="grid grid-cols-2 gap-1">
        {evaluationChecks(checks).map((check) => (
          <li key={check.label} className="flex items-center gap-1.5 text-xs text-white/70">
            <span className={check.ok ? "text-emerald-400" : "text-rose-400"}>
              {check.ok ? "✓" : "✗"}
            </span>
            {check.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Evidence({ result }: { result: ArchitectureComparisonResult }) {
  const evidence = result.evidence;
  if (!evidence) return null;
  const bits: string[] = [];
  if (evidence.agentTypes?.length) bits.push(`${evidence.agentTypes.length} agent(s)`);
  if (typeof evidence.handoffCount === "number") bits.push(`${evidence.handoffCount} handoffs`);
  if (typeof evidence.dependencyCount === "number") {
    bits.push(`${evidence.dependencyCount} deps`);
  }
  if (evidence.planId) bits.push("persisted plan");
  if (bits.length === 0) return null;
  return <p className="text-xs text-white/65">{bits.join(" · ")}</p>;
}

function Metrics({ result }: { result: ArchitectureComparisonResult }) {
  const { metrics } = result;
  const bits: string[] = [formatLatency(metrics.latencyMs)];
  if (metrics.model) bits.push(metrics.model);
  if (typeof metrics.modelCalls === "number") bits.push(`${metrics.modelCalls} call(s)`);
  if (typeof metrics.totalTokens === "number") {
    bits.push(`${formatPoints(metrics.totalTokens)} tokens`);
  }
  return <p className="mt-2 border-t border-white/5 pt-2 font-mono text-xs text-white/65">{bits.join(" · ")}</p>;
}

export type { CardState };
