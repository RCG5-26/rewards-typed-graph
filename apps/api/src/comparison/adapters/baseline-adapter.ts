/**
 * Shared driver for the two read-only LLM baselines. It runs the Python report,
 * normalizes the first case's plan, and packages metrics + evidence. Failures
 * (missing key, subprocess error, malformed output) are caught and returned as a
 * `failed` result so one architecture cannot fail the whole comparison.
 */

import type { ArchitectureComparisonResult, ArchitectureVariant } from "../types";
import {
  type BaselineModule,
  type RunBaselineReport,
  firstCase,
  runBaselineReport,
} from "./baseline-bridge";
import { extractFinalPlan, normalizeBaselinePlan } from "./baseline-normalizer";
import { type AdapterInput, resolveQuery } from "./types";
import { CHAT_CREW_TIMEOUT_MS, SINGLE_AGENT_TIMEOUT_MS } from "../timeouts";

interface BaselineAdapterConfig {
  variant: ArchitectureVariant;
  module: BaselineModule;
  modelCalls: number;
  agentTypes: string[];
  modelEnvKey: string;
  /** Explicit per-variant subprocess bound (review Fix 4). */
  timeoutMs: number;
}

export interface BaselineAdapterOptions extends AdapterInput {
  runReport?: RunBaselineReport;
  env?: NodeJS.ProcessEnv;
  /** Per-scenario baseline fixture/gold paths; default to the canonical pair. */
  fixturePath?: string;
  casesPath?: string;
}

const DEFAULT_MODEL = "gpt-5.5";

async function runBaselineAdapter(
  config: BaselineAdapterConfig,
  options: BaselineAdapterOptions,
): Promise<ArchitectureComparisonResult> {
  const { facts } = options;
  const query = resolveQuery(options);
  const env = options.env ?? process.env;
  const runReport = options.runReport ?? runBaselineReport;
  const startedAt = Date.now();

  const base = {
    variant: config.variant,
    walletId: facts.walletId,
    walletVersion: facts.version,
    query,
  } as const;

  try {
    const report = await runReport(config.module, {
      env,
      timeoutMs: config.timeoutMs,
      ...(options.fixturePath ? { fixturePath: options.fixturePath } : {}),
      ...(options.casesPath ? { casesPath: options.casesPath } : {}),
    });
    const latencyMs = Date.now() - startedAt;
    const caseResult = firstCase(report);
    const rawOutput = caseResult.baseline_plan_record?.raw_output;
    const plan = normalizeBaselinePlan(rawOutput, facts);

    return {
      ...base,
      status: "succeeded",
      plan,
      metrics: {
        latencyMs,
        model: env[config.modelEnvKey] ?? DEFAULT_MODEL,
        modelCalls: config.modelCalls,
        ...(typeof caseResult.token_cost_total === "number"
          ? { totalTokens: caseResult.token_cost_total }
          : {}),
      },
      evidence: buildEvidence(config, rawOutput, facts.awardOptions.map((a) => a.awardSlug)),
    };
  } catch (error) {
    return {
      ...base,
      status: "failed",
      metrics: { latencyMs: Date.now() - startedAt },
      error: {
        category: "baseline_execution_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function buildEvidence(
  config: BaselineAdapterConfig,
  rawOutput: unknown,
  availableAwardIds: string[],
): ArchitectureComparisonResult["evidence"] {
  const finalPlan = extractFinalPlan(rawOutput);
  const citedAwardIds = Array.isArray(finalPlan.ranked_awards)
    ? (finalPlan.ranked_awards as Array<Record<string, unknown>>)
        .map((entry) => entry.award_slug)
        .filter((slug): slug is string => typeof slug === "string")
    : [];
  const transcript =
    rawOutput && typeof rawOutput === "object" && "agent_transcript" in rawOutput
      ? (rawOutput as { agent_transcript?: unknown }).agent_transcript
      : undefined;
  const handoffCount = Array.isArray(transcript) ? transcript.length : undefined;

  return {
    agentTypes: config.agentTypes,
    agentRunCount: config.modelCalls,
    ...(handoffCount !== undefined ? { handoffCount } : {}),
    citedAwardIds,
    availableAwardIds,
  };
}

export function runSingleAgent(
  options: BaselineAdapterOptions,
): Promise<ArchitectureComparisonResult> {
  return runBaselineAdapter(
    {
      variant: "single-agent",
      module: "benchmark.single_agent_baseline",
      modelCalls: 1,
      agentTypes: ["single-agent"],
      modelEnvKey: "SINGLE_AGENT_BASELINE_MODEL",
      timeoutMs: SINGLE_AGENT_TIMEOUT_MS,
    },
    options,
  );
}

export function runChatCrew(
  options: BaselineAdapterOptions,
): Promise<ArchitectureComparisonResult> {
  return runBaselineAdapter(
    {
      variant: "chat-crew",
      module: "benchmark.free_text_multiagent_baseline",
      modelCalls: 4,
      agentTypes: ["wallet_agent", "earning_agent", "redemption_agent", "coordinator"],
      modelEnvKey: "FREE_TEXT_MULTIAGENT_BASELINE_MODEL",
      timeoutMs: CHAT_CREW_TIMEOUT_MS,
    },
    options,
  );
}
