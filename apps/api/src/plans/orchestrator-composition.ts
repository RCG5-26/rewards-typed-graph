import type { Pool } from "pg";

import { ControlledAgentCommitFactory } from "../agents/commit/controlled-commit";
import { PythonWriteBridge } from "../agents/commit/python-write-bridge";
import type { AgentRegistry } from "../agents/contracts";
import { EarningAgent } from "../agents/earning/earning-agent";
import { RedemptionAgent } from "../agents/redemption/redemption-agent";
import { PgGraphSnapshotBuilder } from "../agents/snapshot/pg-snapshot-builder";
import { WalletAgent } from "../agents/wallet/wallet-agent";
import { AgentRunRepository } from "../orchestrator/graph-write/agent-run-repository";
import { DemoQueryDecomposer } from "../orchestrator/demo-decomposer";
import { Orchestrator } from "../orchestrator/orchestrator";
import { BridgePlanProjection } from "./bridge-plan-projection";
import { BridgePlanService } from "./bridge-service";
import {
  OrchestratorPlanService,
  type OrchestratorPlanServiceDeps,
  type ReplanPort,
} from "./orchestrator-service";
import type { PlanService } from "./service";

/**
 * Production composition root for the orchestrator engine (Prompt C, Phases 4–6).
 *
 * This is the single place where the integration lane (Branch A) consumes the
 * production adapters built by the production-adapter lane (Branch B / Prompt B).
 * It never fabricates an in-memory double in production: with no real database
 * pool (and no explicitly injected deps) it FAILS FAST rather than wiring a fake
 * (ADR 0010 §8 — no silent fallback; contracts §4 — no test double in prod).
 *
 * The frozen Prompt B handoff (components M1–M9, Contracts 1–7) consumed here:
 *   - M1 PgGraphSnapshotBuilder (read-only, user-scoped snapshots)
 *   - M2 WalletAgent + RedemptionAgent (+ conformant EarningAgent for the registry type)
 *   - M3 ControlledAgentCommitFactory over PythonWriteBridge (writes via Python boundary)
 *   - M4 AgentRunRepository (plan lifecycle + agent_runs)
 *   - Contract 7 BridgePlanProjection over the additive read-plan subcommand
 * plus the orchestrator-core DemoQueryDecomposer (integration-lane owned).
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

export interface OrchestratorCompositionConfig {
  /**
   * Shared read-only Postgres pool for the snapshot adapter (M1). When provided,
   * the composition root assembles the full production orchestrator engine.
   * Lifecycle (e.g. `pool.end()`) is owned by the caller that created it.
   */
  readonly pool?: Pool;
  readonly env?: NodeJS.ProcessEnv;
  /**
   * Test-only / explicit injection point: a fully-assembled M6 deps bundle.
   * Takes precedence over `pool`. Production boot uses `pool`, not this.
   */
  readonly deps?: OrchestratorPlanServiceDeps;
}

/**
 * Raised at boot when orchestrator mode is selected but the composition root has
 * nothing real to build from — no injected deps and no Postgres pool. A
 * deliberate, inspectable failure: the server must not start a half-mounted
 * orchestrator nor fall back to legacy.
 */
export class AdaptersNotIntegratedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdaptersNotIntegratedError";
  }
}

/**
 * The Prompt B production adapters + orchestrator-core dependency assembled here.
 * Surfaced in the fail-fast message so a boot log doubles as the wiring manifest.
 */
export const EXPECTED_PROMPT_B_HANDOFF: readonly string[] = [
  "PostgreSQL snapshot adapter (M1, PgGraphSnapshotBuilder)",
  "Wallet specialist adapter (M2, WalletAgent)",
  "Redemption specialist adapter (M2, RedemptionAgent)",
  "specialist registry / launcher (M2/M3, AgentRegistry)",
  "controlled graph-write commit adapter (M3, ControlledAgentCommitFactory + PythonWriteBridge)",
  "AgentRun lifecycle adapter + OrchestratorGraphWrite (M4, AgentRunRepository)",
  "PlanProjectionPort over the additive read-plan bridge subcommand (Contract 7, BridgePlanProjection)",
];

/**
 * Assemble the full production {@link OrchestratorPlanServiceDeps} from the
 * Prompt B adapters and the integration-lane decomposer.
 *
 * Wiring notes:
 *  - `readDelegate` is a {@link BridgePlanService}: session/reset/current-plan/
 *    transfer are engine-agnostic reads, NOT a plan-generation fallback —
 *    `OrchestratorPlanService.createPlan` never calls the delegate (ADR 0010 §8).
 *  - `EarningAgent` is registered only because `AgentRegistry` is typed over all
 *    three specialist keys; the decomposer never invokes it and the adapter
 *    throws if it ever runs (unexpected earning fails visibly).
 */
export function buildProductionOrchestratorDeps(
  config: { pool: Pool; env?: NodeJS.ProcessEnv },
): OrchestratorPlanServiceDeps {
  const env = config.env ?? process.env;

  const writeBridge = new PythonWriteBridge({ env });
  const graphWrite = new AgentRunRepository(writeBridge);
  const snapshotBuilder = new PgGraphSnapshotBuilder(config.pool);
  const commitFactory = new ControlledAgentCommitFactory(writeBridge);
  const agentRegistry: AgentRegistry = {
    wallet_agent: new WalletAgent(),
    earning_agent: new EarningAgent(),
    redemption_agent: new RedemptionAgent(),
  };
  const decomposer = new DemoQueryDecomposer();

  const orchestrator = new Orchestrator({
    decomposer,
    graphWrite,
    snapshotBuilder,
    agentRegistry,
    commitFactory,
  });

  // Replan lifecycle over the same controlled Python write boundary. Generation
  // re-enters the orchestrator (above); this port only applies the canonical
  // mutation and promotes/fails the replan job — never the legacy generator.
  const replan: ReplanPort = {
    applyTransfer: (userId, input) =>
      writeBridge.applyBalanceTransfer({
        userId,
        sourceProgramId: input.sourceProgramId,
        destProgramId: input.destProgramId,
        amountPoints: input.amountPoints,
        idempotencyKey: input.idempotencyKey,
      }),
    promote: (params) => writeBridge.promoteReplan(params),
    fail: (params) => writeBridge.failReplan(params),
  };

  return {
    orchestrator,
    projection: new BridgePlanProjection({ env }),
    readDelegate: new BridgePlanService({ env }),
    replan,
  };
}

/**
 * Build the orchestrator `PlanService` (M6).
 *
 *  - `config.deps` injected → use them (explicit / test path).
 *  - `config.pool` provided → assemble the production engine from Prompt B adapters.
 *  - neither → fail fast ({@link AdaptersNotIntegratedError}); never fabricate.
 */
export function composeOrchestratorPlanService(
  config: OrchestratorCompositionConfig = {},
): PlanService {
  if (config.deps) {
    return new OrchestratorPlanService(config.deps);
  }

  if (config.pool) {
    return new OrchestratorPlanService(
      buildProductionOrchestratorDeps({ pool: config.pool, env: config.env }),
    );
  }

  throw new AdaptersNotIntegratedError(
    "PLAN_ENGINE=orchestrator selected but no PostgreSQL pool was provided to the " +
      "composition root. The production adapters require a live database (DATABASE_URL): " +
      EXPECTED_PROMPT_B_HANDOFF.join("; ") +
      ". Boot wiring supplies the shared pool (Phase 6); set PLAN_ENGINE=python-legacy to roll back.",
  );
}
