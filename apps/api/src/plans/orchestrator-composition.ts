import type { Pool } from "pg";

import { OrchestratorPlanService, type OrchestratorPlanServiceDeps } from "./orchestrator-service";
import type { PlanService } from "./service";

/**
 * Production composition root for the orchestrator engine (Prompt C, Phase 4).
 *
 * This is the single place where the integration lane (Branch A) consumes the
 * production adapters built by the production-adapter lane (Branch B / Prompt B).
 * Until that handoff lands, this module deliberately refuses to fabricate
 * adapters: in orchestrator mode the server FAILS TO BOOT with a clear, typed
 * error rather than wiring an in-memory double into production
 * (ADR 0010 §8 — no silent fallback; contracts §4 — no test double in prod).
 *
 * Expected Prompt B handoff surface (frozen contracts §1, components M1–M9).
 * This interface is documentation of the imports the integration step will add
 * here once Prompt B reports `PROMPT B READY FOR C2 INTEGRATION`; the fields are
 * intentionally untyped (`unknown`) because the concrete adapter classes do not
 * exist yet and must not be fabricated at the C1 stop gate.
 */
export interface RequiredOrchestratorAdapters {
  /** M1 — `GraphSnapshotBuilder` reading committed, user-scoped graph rows (Contract 2). */
  readonly snapshotBuilder: unknown;
  /** M2 — `AgentRegistry` of the wallet + redemption (+ conformant earning) adapters (Contract 3). */
  readonly agentRegistry: unknown;
  /** M3 — `AgentCommitFactory` routing writes through the Python boundary (Contracts 4, 6). */
  readonly commitFactory: unknown;
  /** M4 — `OrchestratorGraphWrite` (plan lifecycle + `agent_runs`) (Contract 5). */
  readonly graphWrite: unknown;
  /** Deterministic `Decomposer` for the frozen demo query (orchestrator core dependency). */
  readonly decomposer: unknown;
  /** Contract 7 — `PlanProjectionPort` over the additive `read-plan` bridge subcommand. */
  readonly projection: unknown;
}

/**
 * Runtime configuration the composition root needs once real adapters exist
 * (e.g. the shared pg `Pool` for the read-only snapshot adapter, the env for the
 * bridge marshallers). Held now so the boot seam is stable across the Prompt B
 * integration step.
 */
export interface OrchestratorCompositionConfig {
  readonly pool?: Pool;
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Test-only / post-handoff injection point: the fully-assembled M6 deps
   * (orchestrator runner + projection + read delegate). Production boot leaves
   * this undefined, which triggers the fail-fast below — C1 never fabricates
   * adapters.
   */
  readonly deps?: OrchestratorPlanServiceDeps;
}

/**
 * Raised at boot when orchestrator mode is selected but the Prompt B production
 * adapters have not been integrated. A deliberate, inspectable failure — the
 * server must not start a half-mounted orchestrator nor fall back to legacy.
 */
export class AdaptersNotIntegratedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdaptersNotIntegratedError";
  }
}

/**
 * Exact imports the integration lane will add here once Prompt B reports
 * `PROMPT B READY FOR C2 INTEGRATION`. Surfaced in the fail-fast message so the
 * boot log doubles as the integration checklist.
 */
export const EXPECTED_PROMPT_B_HANDOFF: readonly string[] = [
  "PostgreSQL snapshot adapter (M1, GraphSnapshotBuilder)",
  "Wallet specialist adapter (M2)",
  "Redemption specialist adapter (M2)",
  "specialist launcher / AgentRegistry (M2/M3)",
  "controlled graph-write commit adapter (M3, AgentCommitFactory)",
  "AgentRun lifecycle adapter + OrchestratorGraphWrite (M4)",
  "PlanProjectionPort over the additive read-plan bridge subcommand (Contract 7)",
];

/**
 * Assemble the orchestrator `PlanService` (M6) from the production adapters.
 *
 * C1 state: production adapters are not yet available, so this throws
 * {@link AdaptersNotIntegratedError}. When `config.deps` is injected (integration
 * tests / post-handoff wiring) it builds the real {@link OrchestratorPlanService}.
 */
export function composeOrchestratorPlanService(
  config: OrchestratorCompositionConfig = {},
): PlanService {
  if (!config.deps) {
    throw new AdaptersNotIntegratedError(
      "PLAN_ENGINE=orchestrator selected but production adapters are not integrated yet. " +
        "Prompt C (integration) is at the C1 stop gate; awaiting the Prompt B handoff: " +
        EXPECTED_PROMPT_B_HANDOFF.join("; ") +
        ". Set PLAN_ENGINE=python-legacy to boot the stable engine.",
    );
  }

  return new OrchestratorPlanService(config.deps);
}
