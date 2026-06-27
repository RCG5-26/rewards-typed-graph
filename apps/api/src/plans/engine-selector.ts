import { BridgePlanService } from "./bridge-service";
import { composeOrchestratorPlanService } from "./orchestrator-composition";
import type { PlanService } from "./service";

/**
 * The two Plan-generation engines (ADR 0010). `python-legacy` is the stable
 * D031 bridge (rollback engine); `orchestrator` is the thesis-verification
 * TypeScript runtime. Engine selection happens once at boot from `PLAN_ENGINE`.
 */
export type PlanEngineKind = "python-legacy" | "orchestrator";

export const PLAN_ENGINE_KINDS: readonly PlanEngineKind[] = ["python-legacy", "orchestrator"];

/**
 * The recommended explicit value for normal operation and the rollback target
 * (ADR 0010 — Rollback). It is NOT an implicit default: `PLAN_ENGINE` must be
 * set explicitly or the server fails fast (see {@link parsePlanEngine}).
 */
export const RECOMMENDED_PLAN_ENGINE: PlanEngineKind = "python-legacy";

/**
 * Boot-time configuration failure for `PLAN_ENGINE`. Thrown (not swallowed) so
 * an unset/invalid value stops the server before it can serve a request under
 * an ambiguous engine — the contracts list "PLAN_ENGINE unset not failing fast
 * at boot" as thesis-invalidating.
 */
export class PlanEngineConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanEngineConfigError";
  }
}

function isPlanEngineKind(value: string): value is PlanEngineKind {
  return (PLAN_ENGINE_KINDS as readonly string[]).includes(value);
}

/**
 * Resolve and validate `PLAN_ENGINE`. Fail-fast on unset, empty, or unknown
 * values (ADR 0010 §3 — no implicit default, no silent selection). Surrounding
 * whitespace is trimmed; matching is exact and case-sensitive.
 */
export function parsePlanEngine(raw: string | undefined): PlanEngineKind {
  const value = raw?.trim() ?? "";
  if (value.length === 0) {
    throw new PlanEngineConfigError(
      `PLAN_ENGINE is required and must be one of: ${PLAN_ENGINE_KINDS.join(", ")}. ` +
        `Set PLAN_ENGINE=${RECOMMENDED_PLAN_ENGINE} for the stable default.`,
    );
  }
  if (!isPlanEngineKind(value)) {
    throw new PlanEngineConfigError(
      `PLAN_ENGINE="${value}" is not a known engine. Valid values: ${PLAN_ENGINE_KINDS.join(", ")}.`,
    );
  }
  return value;
}

/** Safe, secret-free structured evidence of the engine selection for boot logs and `/health`. */
export interface PlanEngineEvidence {
  readonly engine: PlanEngineKind;
  /** Always false: rollback is a boot-time switch, never an automatic per-request fallback. */
  readonly perRequestFallbackAllowed: false;
}

export function describePlanEngineSelection(engine: PlanEngineKind): PlanEngineEvidence {
  return { engine, perRequestFallbackAllowed: false };
}

/**
 * Factories for each engine, injected so selection logic stays pure and the
 * no-fallback guarantee is verifiable: exactly one factory runs per call, and
 * a construction failure propagates rather than crossing to the other engine.
 */
export interface PlanEngineFactories {
  readonly legacy: () => PlanService;
  readonly orchestrator: () => PlanService;
}

/**
 * Build the selected `PlanService`. There is no cross-engine fallback: the
 * `orchestrator` branch never reaches `legacy` (and vice versa), so an
 * orchestrator construction failure surfaces as a boot error, never a silent
 * downgrade to the bridge (ADR 0010 §8).
 */
export function createPlanService(
  engine: PlanEngineKind,
  factories: PlanEngineFactories,
): PlanService {
  switch (engine) {
    case "python-legacy":
      return factories.legacy();
    case "orchestrator":
      return factories.orchestrator();
    default: {
      const exhaustive: never = engine;
      throw new PlanEngineConfigError(`unhandled plan engine: ${String(exhaustive)}`);
    }
  }
}

export interface BootedPlanService {
  readonly engine: PlanEngineKind;
  readonly service: PlanService;
  readonly evidence: PlanEngineEvidence;
}

/**
 * The single boot seam consumed by `server.ts`: parse `PLAN_ENGINE` from the
 * environment, construct the matching engine, and return safe startup evidence.
 * Keeps `server.ts` thin and this logic fully unit-testable.
 *
 * Under `orchestrator`, construction delegates to the composition root, which
 * fails fast until the Prompt B adapters are integrated (C1 stop gate).
 */
export function bootPlanService(env: NodeJS.ProcessEnv): BootedPlanService {
  const engine = parsePlanEngine(env.PLAN_ENGINE);
  const service = createPlanService(engine, {
    legacy: () => new BridgePlanService(),
    orchestrator: () => composeOrchestratorPlanService({ env }),
  });
  return { engine, service, evidence: describePlanEngineSelection(engine) };
}
