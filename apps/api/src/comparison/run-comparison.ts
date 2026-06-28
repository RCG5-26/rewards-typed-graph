/**
 * Orchestrate one three-architecture comparison run (freeze Step 7). Resolves
 * canonical facts server-side, runs all three adapters independently with
 * `Promise.allSettled`, then applies the single deterministic evaluator to every
 * succeeded plan. One architecture failing never fails the others — its slot
 * comes back as a `failed` result while the rest carry plans and evaluations.
 */

import { type ApprovedWalletId, getCanonicalWallet } from "./canonical-wallet";
import { type GraphPlanRunner, runGraphOrchestrator } from "./adapters/graph-orchestrator";
import { runChatCrew, runSingleAgent } from "./adapters/baseline-adapter";
import type { RunBaselineReport } from "./adapters/baseline-bridge";
import { evaluatePlan } from "./evaluator";
import type { PlanEngineKind } from "../plans/engine-selector";
import type { PlanService } from "../plans/service";
import type {
  ArchitectureComparisonResponse,
  ArchitectureComparisonResult,
  ArchitectureVariant,
} from "./types";

/**
 * The graph variant is the LIVE TypeScript orchestrator. It is only honest to
 * run and label it as such when the server actually booted that engine
 * (review Fix 2 / ADR 0010). Under `python-legacy` the injected `graphService`
 * is the Python bridge — running it would mislabel a legacy plan as the live
 * graph orchestrator, so the slot fails fast with a sanitized config error.
 */
const GRAPH_ENGINE: PlanEngineKind = "orchestrator";

export interface ComparisonDeps {
  /** Live graph plan runner (the real `PlanService` satisfies this). */
  graphService: GraphPlanRunner;
  /**
   * The engine the server booted under (`/health` reports the same value).
   * The graph slot only runs when this is `orchestrator`; ANY other value —
   * including `undefined` — fails the slot closed with a config error so a
   * legacy plan is never mislabeled as the live graph orchestrator (Fix 2).
   * Optional so the shared `app.ts` mount needs only a one-line integration
   * patch to supply it (Fix 6); until then the graph fails closed, not silent.
   */
  planEngine?: PlanEngineKind;
  /**
   * Full plan service for demo replan simulate. Defaults to the same instance as
   * `graphService` when wired from `app.ts`.
   */
  replanService?: PlanService;
  /** Graph persona; defaults to the canonical demo user inside the adapter. */
  graphUserId?: string;
  /** Injected for tests; defaults to the real Python subprocess. */
  runReport?: RunBaselineReport;
  /** Injected for tests; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/** Fixed display order: graph, then chat crew, then single agent. */
const RESULT_ORDER: ArchitectureVariant[] = [
  "live-graph-orchestrator",
  "chat-crew",
  "single-agent",
];

export async function runArchitectureComparison(
  walletId: ApprovedWalletId,
  query: string,
  deps: ComparisonDeps,
): Promise<ArchitectureComparisonResponse> {
  const facts = getCanonicalWallet(walletId);
  if (!facts) {
    throw new Error(`unknown canonical wallet: ${walletId}`);
  }
  const input = { facts, query };
  const baselineExtras = {
    ...(deps.runReport ? { runReport: deps.runReport } : {}),
    ...(deps.env ? { env: deps.env } : {}),
  };

  const graphRun =
    deps.planEngine === GRAPH_ENGINE
      ? runGraphOrchestrator({
          ...input,
          service: deps.graphService,
          ...(deps.graphUserId ? { userId: deps.graphUserId } : {}),
        })
      : Promise.resolve(graphEngineConfigFailure(deps.planEngine, facts.walletId, facts.version, query));

  const settled = await Promise.allSettled([
    graphRun,
    runChatCrew({ ...input, ...baselineExtras }),
    runSingleAgent({ ...input, ...baselineExtras }),
  ]);

  const results = settled.map((outcome, index) =>
    evaluateResult(toResult(outcome, RESULT_ORDER[index], facts.walletId, facts.version, query), facts),
  );

  return { walletId: facts.walletId, walletVersion: facts.version, query, results };
}

/**
 * Sanitized graph-slot failure when the booted engine is not `orchestrator`
 * (review Fix 2). Keeps the slot present and honestly `failed` — never a
 * succeeded `live-graph-orchestrator` plan produced by the legacy engine.
 */
function graphEngineConfigFailure(
  engine: PlanEngineKind | undefined,
  walletId: string,
  walletVersion: string,
  query: string,
): ArchitectureComparisonResult {
  return {
    variant: "live-graph-orchestrator",
    status: "failed",
    walletId,
    walletVersion,
    query,
    metrics: { latencyMs: 0 },
    error: {
      category: "engine_configuration_error",
      message: `live graph orchestrator requires PLAN_ENGINE=${GRAPH_ENGINE} (server booted "${engine ?? "unset"}")`,
    },
  };
}

/** Attach a deterministic evaluation to any succeeded result that has a plan. */
function evaluateResult(
  result: ArchitectureComparisonResult,
  facts: NonNullable<ReturnType<typeof getCanonicalWallet>>,
): ArchitectureComparisonResult {
  if (result.status === "succeeded" && result.plan) {
    return { ...result, evaluation: evaluatePlan(result.plan, facts) };
  }
  return result;
}

/**
 * Adapters already trap their own errors and return `failed` results, so a
 * rejected promise here is an unexpected adapter bug — still surfaced as a
 * `failed` result so the response always has all three slots.
 */
function toResult(
  outcome: PromiseSettledResult<ArchitectureComparisonResult>,
  variant: ArchitectureVariant,
  walletId: string,
  walletVersion: string,
  query: string,
): ArchitectureComparisonResult {
  if (outcome.status === "fulfilled") return outcome.value;
  return {
    variant,
    status: "failed",
    walletId,
    walletVersion,
    query,
    metrics: { latencyMs: 0 },
    error: {
      category: "adapter_crash",
      message: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
    },
  };
}
