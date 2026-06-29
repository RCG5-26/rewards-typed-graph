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

/** Tinted status panel fills (warning/error), driven by the design tokens. */
const WARNING_PANEL_STYLE = {
  background: "var(--color-warning-bg)",
  border: "1px solid color-mix(in srgb, var(--color-warning) 24%, transparent)",
} as const;
const ERROR_PANEL_STYLE = {
  background: "var(--color-error-bg)",
  border: "1px solid color-mix(in srgb, var(--color-error) 24%, transparent)",
} as const;

const VALIDITY_PILL_STYLE: Record<"valid" | "incomplete" | "invalid", { background: string; color: string }> = {
  valid: {
    background: "color-mix(in srgb, var(--color-success) 16%, transparent)",
    color: "var(--color-success)",
  },
  incomplete: {
    background: "color-mix(in srgb, var(--color-warning) 16%, transparent)",
    color: "var(--color-warning)",
  },
  invalid: {
    background: "color-mix(in srgb, var(--color-error) 16%, transparent)",
    color: "var(--color-error)",
  },
};

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
      className="flex flex-col rounded-card border border-subtle bg-surface p-5 shadow-raised"
      aria-label={`${VARIANT_LABELS[variant]} result`}
    >
      <header className="mb-4 space-y-1">
        <h3 className="text-base font-semibold text-text-primary">{VARIANT_LABELS[variant]}</h3>
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
        <dt className="text-text-tertiary">Execution</dt>
        <dd className="text-text-secondary">Not started</dd>
        <dt className="text-text-tertiary">Plan validity</dt>
        <dd className="text-text-tertiary">—</dd>
      </dl>
    );
  }
  if (state.phase === "loading") {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs" aria-busy="true">
        <dt className="text-text-tertiary">Execution</dt>
        <dd className="text-warning">Running…</dd>
        <dt className="text-text-tertiary">Plan validity</dt>
        <dd className="text-text-tertiary">—</dd>
      </dl>
    );
  }

  const { result } = state;
  const executionLabel = executionStatusLabel(result);
  const executionColor = executionStatusColor(result);

  const validity = result.evaluation ? derivePlanValidity(result.evaluation) : null;
  const validityLabel = validity ? planValidityLabel(validity) : "—";
  const validityColor = validity ? planValidityColor(validity) : "text-text-tertiary";

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
      <dt className="text-text-tertiary">Execution</dt>
      <dd className={executionColor}>{executionLabel}</dd>
      <dt className="text-text-tertiary">Plan validity</dt>
      <dd className={validityColor}>{validityLabel}</dd>
      {result.metrics.latencyMs ? (
        <>
          <dt className="text-text-tertiary">Latency</dt>
          <dd className="font-mono text-text-secondary">{formatLatency(result.metrics.latencyMs)}</dd>
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
      return "text-success";
    case "failed":
    case "timed_out":
      return "text-error";
    case "running":
      return "text-warning";
    default:
      return "text-text-tertiary";
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
      return "text-success";
    case "incomplete":
      return "text-warning";
    case "invalid":
      return "text-error";
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
      <p className="text-sm text-text-secondary">
        Run the comparison to see this architecture&apos;s plan.
      </p>
    );
  }
  if (state.phase === "loading") {
    return (
      <div className="space-y-2" aria-label="Loading result" aria-busy="true">
        <div className="h-3 w-3/4 animate-pulse motion-reduce:animate-none rounded bg-white/[0.06]" />
        <div className="h-3 w-2/3 animate-pulse motion-reduce:animate-none rounded bg-white/[0.06]" />
        <div className="h-3 w-1/2 animate-pulse motion-reduce:animate-none rounded bg-white/[0.06]" />
        <div className="h-3 w-5/6 animate-pulse motion-reduce:animate-none rounded bg-white/[0.06]" />
      </div>
    );
  }

  const { result } = state;

  if (result.status !== "succeeded" || !result.plan) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg p-3" style={ERROR_PANEL_STYLE}>
          <p className="text-sm font-medium" style={{ color: "var(--color-error-fg)" }}>
            {result.error?.message ?? "This architecture did not return a plan."}
          </p>
          {result.error?.category ? (
            <p className="mt-1 font-mono text-xs text-text-tertiary">{result.error.category}</p>
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
        <p className="text-sm text-text-secondary">{plan.summary}</p>
      ) : null}

      {/* Incomplete recommendation notice */}
      {missingFields.length > 0 ? (
        <div className="rounded-lg p-3" style={WARNING_PANEL_STYLE}>
          <p className="text-xs font-semibold text-warning">Incomplete recommendation</p>
          <p className="mt-0.5 text-xs text-text-secondary">Missing:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {missingFields.map((field) => (
              <li key={field} className="text-xs text-text-secondary">
                {field}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Normalized recommendation fields */}
      <dl className="space-y-1.5 text-sm">
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 text-text-tertiary">Selected award</dt>
          <dd className="text-right text-text-primary">
            {selectedAward ? (
              selectedAward.displayName
            ) : plan.selectedAwardId ? (
              <span className="font-mono text-xs text-text-secondary">{plan.selectedAwardId}</span>
            ) : (
              <span className="text-text-tertiary">—</span>
            )}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 text-text-tertiary">Transfer</dt>
          <dd className="text-right text-text-primary">
            {plan.transferRequired ? (
              <>
                {formatPoints(plan.transferAmount)} pts{" "}
                <span className="text-text-secondary">Chase → Hyatt</span>
              </>
            ) : plan.steps.some((s) => s.actionType === "transfer") ? (
              "See steps"
            ) : (
              <span className="text-text-tertiary">None</span>
            )}
          </dd>
        </div>
        {plan.redemptionPoints ? (
          <div className="flex items-start justify-between gap-3">
            <dt className="shrink-0 text-text-tertiary">Redemption</dt>
            <dd className="text-right text-text-primary">
              {formatPoints(plan.redemptionPoints)} pts
              {selectedAward ? (
                <span className="text-text-secondary"> · {selectedAward.programSlug.replace("program:", "")}</span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>

      {/* Ordered steps */}
      {plan.steps.length > 0 ? (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
            Steps
          </h4>
          <ol className="space-y-2 border-l border-subtle pl-3">
            {plan.steps.map((step) => (
              <li key={step.order} className="text-sm">
                <span className="text-xs font-medium text-text-tertiary">{step.order}.</span>{" "}
                <span className="font-medium text-text-primary">{actionLabel(step.actionType)}</span>
                {" — "}
                <span className="text-text-secondary">{step.title}</span>
                {step.actionType === "transfer" && step.sourceProgramId ? (
                  <div className="mt-0.5 text-xs text-text-tertiary">
                    {programName(facts, step.sourceProgramId)} →{" "}
                    {programName(facts, step.destinationProgramId)}
                    {step.points !== undefined ? ` · ${formatPoints(step.points)} pts` : ""}
                  </div>
                ) : null}
                {step.actionType === "redeem" && step.awardId ? (
                  <div className="mt-0.5 text-xs text-text-tertiary">
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
        <h4 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
          Independent evaluation
        </h4>
        {validity ? (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={VALIDITY_PILL_STYLE[validity]}
          >
            {planValidityLabel(validity)}
          </span>
        ) : null}
      </div>
      <ul className="grid grid-cols-2 gap-1">
        {checks.map((check) => (
          <li
            key={check.label}
            className="flex items-center gap-1.5 text-xs text-text-secondary"
          >
            <span
              className={check.ok ? "text-success" : "text-error"}
              aria-hidden="true"
            >
              {check.ok ? "✓" : "✗"}
            </span>
            <span className={!check.ok ? "text-error" : ""}>{check.label}</span>
          </li>
        ))}
      </ul>
      {errorIssues.length > 0 ? (
        <div className="mt-3">
          <h5 className="text-xs font-semibold text-error">Why this Plan is invalid</h5>
          {/* The evaluator's human-readable messages are the primary findings;
              the raw issue codes are tucked into a collapsed disclosure. */}
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {errorIssues.map((issue) => (
              <li key={issue.code} className="text-[11px] text-error">
                {issue.message}
              </li>
            ))}
          </ul>
          <details className="mt-1.5">
            <summary className="cursor-pointer text-[10px] font-medium uppercase tracking-wide text-text-tertiary [&::-webkit-details-marker]:hidden">
              Technical details
            </summary>
            <ul className="mt-1 space-y-0.5">
              {errorIssues.map((issue) => (
                <li key={issue.code} className="font-mono text-[10px] text-text-tertiary">
                  {issue.code}
                </li>
              ))}
            </ul>
          </details>
        </div>
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
    <p className="text-xs text-text-tertiary" aria-label="Architecture evidence">
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
    <p className="border-t border-subtle pt-2 font-mono text-xs text-text-tertiary">
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
