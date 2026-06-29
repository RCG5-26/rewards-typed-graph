import type {
  ArchitectureComparisonResult,
  ArchitectureVariant,
  PlanEvaluation,
  PublicAwardOption,
  PublicWalletFacts,
} from "@/lib/comparison/types";
import { VARIANT_LABELS, derivePlanValidity } from "@/lib/comparison/types";
import {
  actionLabel,
  evaluationChecks,
  formatLatency,
  formatPoints,
  programName,
} from "@/lib/comparison/presentation";

export type CardState =
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
    <article
      className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5"
      aria-label={`${VARIANT_LABELS[variant]} result`}
    >
      <header className="mb-4 space-y-1">
        <h3 className="text-base font-semibold text-white">{VARIANT_LABELS[variant]}</h3>
        <StatusRows state={state} facts={facts} />
      </header>
      <Body variant={variant} facts={facts} state={state} />
    </article>
  );
}

// ---------------------------------------------------------------------------
// Header status rows — execution and plan validity are always shown separately
// ---------------------------------------------------------------------------

function StatusRows({
  state,
  facts,
}: {
  state: CardState;
  facts: PublicWalletFacts;
}) {
  if (state.phase === "idle") {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className="text-white/45">Execution</dt>
        <dd className="text-white/55">Not started</dd>
        <dt className="text-white/45">Plan validity</dt>
        <dd className="text-white/45">—</dd>
      </dl>
    );
  }
  if (state.phase === "loading") {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs" aria-busy="true">
        <dt className="text-white/45">Execution</dt>
        <dd className="text-amber-300/80">Running…</dd>
        <dt className="text-white/45">Plan validity</dt>
        <dd className="text-white/45">—</dd>
      </dl>
    );
  }

  const { result } = state;
  const executionLabel = executionStatusLabel(result);
  const executionColor = executionStatusColor(result);

  const validity = result.evaluation ? derivePlanValidity(result.evaluation) : null;
  const validityLabel = validity ? planValidityLabel(validity) : "—";
  const validityColor = validity ? planValidityColor(validity) : "text-white/45";

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      <dt className="text-white/45">Execution</dt>
      <dd className={executionColor}>{executionLabel}</dd>
      <dt className="text-white/45">Plan validity</dt>
      <dd className={validityColor}>{validityLabel}</dd>
      {result.metrics.latencyMs ? (
        <>
          <dt className="text-white/45">Latency</dt>
          <dd className="font-mono text-white/55">{formatLatency(result.metrics.latencyMs)}</dd>
        </>
      ) : null}
    </dl>
  );
}

function executionStatusLabel(result: ArchitectureComparisonResult): string {
  switch (result.status) {
    case "succeeded":
      return "Completed";
    case "failed":
      return "Failed";
    case "timed_out":
      return "Timed out";
    case "running":
      return "Running…";
    default:
      return "Not started";
  }
}

function executionStatusColor(result: ArchitectureComparisonResult): string {
  switch (result.status) {
    case "succeeded":
      return "text-emerald-300";
    case "failed":
    case "timed_out":
      return "text-rose-300";
    case "running":
      return "text-amber-300";
    default:
      return "text-white/45";
  }
}

function planValidityLabel(validity: "valid" | "incomplete" | "invalid"): string {
  switch (validity) {
    case "valid":
      return "Valid Plan";
    case "incomplete":
      return "Incomplete Plan";
    case "invalid":
      return "Invalid Plan";
  }
}

function planValidityColor(validity: "valid" | "incomplete" | "invalid"): string {
  switch (validity) {
    case "valid":
      return "text-emerald-300";
    case "incomplete":
      return "text-amber-300";
    case "invalid":
      return "text-rose-300";
  }
}

// ---------------------------------------------------------------------------
// Card body
// ---------------------------------------------------------------------------

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
    return (
      <p className="text-sm text-white/55">
        Run the comparison to see this architecture&apos;s plan.
      </p>
    );
  }
  if (state.phase === "loading") {
    return (
      <div className="space-y-2" aria-label="Loading result" aria-busy="true">
        <div className="h-3 w-3/4 animate-pulse motion-reduce:animate-none rounded bg-white/10" />
        <div className="h-3 w-2/3 animate-pulse motion-reduce:animate-none rounded bg-white/10" />
        <div className="h-3 w-1/2 animate-pulse motion-reduce:animate-none rounded bg-white/10" />
        <div className="h-3 w-5/6 animate-pulse motion-reduce:animate-none rounded bg-white/10" />
      </div>
    );
  }

  const { result } = state;

  if (result.status !== "succeeded" || !result.plan) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
          <p className="text-sm font-medium text-rose-200">
            {result.error?.message ?? "This architecture did not return a plan."}
          </p>
          {result.error?.category ? (
            <p className="mt-1 font-mono text-xs text-rose-300/55">{result.error.category}</p>
          ) : null}
        </div>
        <MetricsRow result={result} />
      </div>
    );
  }

  const { plan, evaluation } = result;
  const selectedAward = findAward(facts, plan.selectedAwardId);
  const missingFields = evaluation ? getMissingFields(evaluation) : [];
  const validity = evaluation ? derivePlanValidity(evaluation) : null;

  return (
    <div className="space-y-4">
      {/* Plan summary */}
      {plan.summary ? (
        <p className="text-sm text-white/75">{plan.summary}</p>
      ) : null}

      {/* Incomplete recommendation notice */}
      {missingFields.length > 0 ? (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-xs font-semibold text-amber-200">Incomplete recommendation</p>
          <p className="mt-0.5 text-xs text-amber-100/70">Missing:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {missingFields.map((field) => (
              <li key={field} className="text-xs text-amber-100/70">
                {field}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Normalized recommendation fields */}
      <dl className="space-y-1.5 text-sm">
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 text-white/50">Selected award</dt>
          <dd className="text-right text-white/90">
            {selectedAward ? (
              selectedAward.displayName
            ) : plan.selectedAwardId ? (
              <span className="font-mono text-xs text-white/55">{plan.selectedAwardId}</span>
            ) : (
              <span className="text-white/30">—</span>
            )}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 text-white/50">Transfer</dt>
          <dd className="text-right text-white/90">
            {plan.transferRequired ? (
              <>
                {formatPoints(plan.transferAmount)} pts{" "}
                <span className="text-white/55">Chase → Hyatt</span>
              </>
            ) : plan.steps.some((s) => s.actionType === "transfer") ? (
              "See steps"
            ) : (
              <span className="text-white/30">None</span>
            )}
          </dd>
        </div>
        {plan.redemptionPoints ? (
          <div className="flex items-start justify-between gap-3">
            <dt className="shrink-0 text-white/50">Redemption</dt>
            <dd className="text-right text-white/90">
              {formatPoints(plan.redemptionPoints)} pts
              {selectedAward ? (
                <span className="text-white/55"> · {selectedAward.programSlug.replace("program:", "")}</span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>

      {/* Ordered steps */}
      {plan.steps.length > 0 ? (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/50">
            Steps
          </h4>
          <ol className="space-y-2 border-l border-white/10 pl-3">
            {plan.steps.map((step) => (
              <li key={step.order} className="text-sm">
                <span className="text-xs font-medium text-white/55">{step.order}.</span>{" "}
                <span className="font-medium text-white/85">{actionLabel(step.actionType)}</span>
                {" — "}
                <span className="text-white/70">{step.title}</span>
                {step.actionType === "transfer" && step.sourceProgramId ? (
                  <div className="mt-0.5 text-xs text-white/45">
                    {programName(facts, step.sourceProgramId)} →{" "}
                    {programName(facts, step.destinationProgramId)}
                    {step.points !== undefined ? ` · ${formatPoints(step.points)} pts` : ""}
                  </div>
                ) : null}
                {step.actionType === "redeem" && step.awardId ? (
                  <div className="mt-0.5 text-xs text-white/45">
                    {findAward(facts, step.awardId)?.displayName ?? step.awardId}
                    {step.points !== undefined ? ` · ${formatPoints(step.points)} pts` : ""}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {/* Independent evaluation */}
      {evaluation ? (
        <EvaluationSection evaluation={evaluation} validity={validity} />
      ) : null}

      {/* Architecture evidence */}
      <EvidenceRow result={result} />

      {/* Metrics */}
      <MetricsRow result={result} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EvaluationSection({
  evaluation,
  validity,
}: {
  evaluation: PlanEvaluation;
  validity: "valid" | "incomplete" | "invalid" | null;
}) {
  const checks = evaluationChecks(evaluation);
  const errorIssues = evaluation.issues.filter((i) => i.severity === "error");

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-white/50">
          Independent evaluation
        </h4>
        {validity ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              validity === "valid"
                ? "bg-emerald-500/15 text-emerald-300"
                : validity === "incomplete"
                  ? "bg-amber-500/15 text-amber-300"
                  : "bg-rose-500/15 text-rose-300"
            }`}
          >
            {planValidityLabel(validity)}
          </span>
        ) : null}
      </div>
      <ul className="grid grid-cols-2 gap-1">
        {checks.map((check) => (
          <li
            key={check.label}
            className="flex items-center gap-1.5 text-xs text-white/65"
          >
            <span
              className={check.ok ? "text-emerald-400" : "text-rose-400"}
              aria-hidden="true"
            >
              {check.ok ? "✓" : "✗"}
            </span>
            <span className={!check.ok ? "text-rose-300/80" : ""}>{check.label}</span>
          </li>
        ))}
      </ul>
      {errorIssues.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {errorIssues.map((issue) => (
            <li key={issue.code} className="text-[11px] text-rose-300/70">
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function EvidenceRow({ result }: { result: ArchitectureComparisonResult }) {
  const evidence = result.evidence;
  if (!evidence) return null;
  const bits: string[] = [];
  if (evidence.agentTypes?.length) bits.push(`${evidence.agentTypes.length} agent type(s)`);
  if (typeof evidence.handoffCount === "number") bits.push(`${evidence.handoffCount} handoff(s)`);
  if (typeof evidence.agentRunCount === "number") bits.push(`${evidence.agentRunCount} run(s)`);
  if (evidence.revisionNumber) bits.push(`rev ${evidence.revisionNumber}`);
  if (evidence.planId) bits.push("persisted plan");
  if (bits.length === 0) return null;
  return (
    <p className="text-xs text-white/45" aria-label="Architecture evidence">
      {bits.join(" · ")}
    </p>
  );
}

function MetricsRow({ result }: { result: ArchitectureComparisonResult }) {
  const { metrics } = result;
  const bits: string[] = [];
  if (metrics.model) bits.push(metrics.model);
  if (typeof metrics.modelCalls === "number") bits.push(`${metrics.modelCalls} call(s)`);
  if (typeof metrics.totalTokens === "number") {
    bits.push(`${formatPoints(metrics.totalTokens)} tokens`);
  }
  if (bits.length === 0) return null;
  return (
    <p className="border-t border-white/5 pt-2 font-mono text-xs text-white/40">
      {bits.join(" · ")}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findAward(facts: PublicWalletFacts, id: string | undefined): PublicAwardOption | undefined {
  if (!id) return undefined;
  return facts.awardOptions?.find((a) => a.awardId === id || a.awardSlug === id);
}

function getMissingFields(evaluation: PlanEvaluation): string[] {
  return evaluation.issues
    .filter((i) => i.severity === "warning" && i.code.startsWith("missing_"))
    .map((i) => {
      switch (i.code) {
        case "missing_selected_award":
          return "selected award";
        case "missing_redemption":
          return "actionable redemption step";
        case "missing_actionable_step":
          return "transfer or redeem step";
        default:
          return i.code;
      }
    });
}
