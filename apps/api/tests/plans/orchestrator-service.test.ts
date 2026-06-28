import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { PlanProjectionPort, PlanRequest, PlanResult } from "../../src/orchestrator/contracts";
import { BridgePlanService } from "../../src/plans/bridge-service";
import { composeOrchestratorPlanService } from "../../src/plans/orchestrator-composition";
import {
  OrchestratorPlanError,
  OrchestratorPlanService,
  type OrchestratorPlanServiceDeps,
  type OrchestratorReadDelegate,
  type OrchestratorRunner,
} from "../../src/plans/orchestrator-service";
import type { PlanService } from "../../src/plans/service";
import type { PlanView, SessionView } from "../../src/plans/types";

const USER_ID = "00000000-0000-0000-0000-00000000a001";

const samplePlan: PlanView = {
  planId: "11111111-1111-1111-1111-111111111111",
  planLineageId: "22222222-2222-2222-2222-222222222222",
  revisionNumber: 1,
  status: "current",
  query: "Book a 3-night Hyatt award stay in Tokyo in October using my points.",
  summary: "Transfer Chase UR to Hyatt, then redeem.",
  steps: [],
  graph: { nodes: [], edges: [] },
};

const currentResult: PlanResult = {
  planId: samplePlan.planId,
  planLineageId: samplePlan.planLineageId,
  status: "current",
  agentRunIds: ["run-wallet", "run-redemption"],
};

function buildService(
  overrides: {
    runner?: Partial<OrchestratorRunner>;
    projection?: Partial<PlanProjectionPort>;
    readDelegate?: Partial<OrchestratorReadDelegate>;
  } = {},
): {
  service: OrchestratorPlanService;
  runner: OrchestratorRunner;
  projection: PlanProjectionPort;
  readDelegate: OrchestratorReadDelegate;
} {
  const runner: OrchestratorRunner = {
    run: overrides.runner?.run ?? vi.fn(async () => currentResult),
  };
  const projection: PlanProjectionPort = {
    project: overrides.projection?.project ?? vi.fn(async () => samplePlan),
  };
  const readDelegate: OrchestratorReadDelegate = {
    getSession:
      overrides.readDelegate?.getSession ??
      vi.fn(async () => ({ userId: USER_ID, clerkId: "clerk_hero_demo", seeded: true })),
    resetDemo:
      overrides.readDelegate?.resetDemo ??
      vi.fn(async () => ({ userId: USER_ID, clerkId: "clerk_hero_demo", seeded: true })),
    getCurrentPlan: overrides.readDelegate?.getCurrentPlan ?? vi.fn(async () => samplePlan),
    transferBalance:
      overrides.readDelegate?.transferBalance ??
      vi.fn(async () => ({
        planLineageId: samplePlan.planLineageId,
        staledPlanId: samplePlan.planId,
        replanJobId: "33333333-3333-3333-3333-333333333333",
        currentPlan: { ...samplePlan, revisionNumber: 2 },
      })),
  };
  const deps: OrchestratorPlanServiceDeps = { orchestrator: runner, projection, readDelegate };
  return { service: new OrchestratorPlanService(deps), runner, projection, readDelegate };
}

describe("OrchestratorPlanService.createPlan (M6 — Contracts 1 + 7)", () => {
  it("runs the orchestrator then projects the persisted plan into a PlanView", async () => {
    const run = vi.fn(async (req: PlanRequest) => {
      expect(req).toEqual({ userId: USER_ID, queryText: samplePlan.query });
      return currentResult;
    });
    const project = vi.fn(async (planId: string, userId: string) => {
      expect(planId).toBe(samplePlan.planId);
      expect(userId).toBe(USER_ID);
      return samplePlan;
    });
    const { service } = buildService({ runner: { run }, projection: { project } });

    const view = await service.createPlan(USER_ID, samplePlan.query);

    expect(view).toEqual(samplePlan);
    expect(run).toHaveBeenCalledOnce();
    expect(project).toHaveBeenCalledOnce();
  });

  it("never invokes the read delegate during plan generation (no fallback)", async () => {
    const { service, readDelegate } = buildService();
    await service.createPlan(USER_ID, samplePlan.query);
    expect(readDelegate.getCurrentPlan).not.toHaveBeenCalled();
    expect(readDelegate.transferBalance).not.toHaveBeenCalled();
  });

  it("throws (no fallback) when the orchestrator returns a failed result", async () => {
    const failed: PlanResult = { ...currentResult, status: "failed" };
    const project = vi.fn();
    const { service, readDelegate } = buildService({
      runner: { run: vi.fn(async () => failed) },
      projection: { project },
    });

    await expect(service.createPlan(USER_ID, samplePlan.query)).rejects.toBeInstanceOf(
      OrchestratorPlanError,
    );
    expect(project).not.toHaveBeenCalled();
    expect(readDelegate.transferBalance).not.toHaveBeenCalled();
  });

  it("throws when the projection returns no view for a committed plan", async () => {
    const { service } = buildService({ projection: { project: vi.fn(async () => null) } });
    await expect(service.createPlan(USER_ID, samplePlan.query)).rejects.toBeInstanceOf(
      OrchestratorPlanError,
    );
  });

  it("rejects a malformed projection (missing required fields)", async () => {
    const malformed = { ...samplePlan, planLineageId: "" } as PlanView;
    const { service } = buildService({ projection: { project: vi.fn(async () => malformed) } });
    await expect(service.createPlan(USER_ID, samplePlan.query)).rejects.toThrow(/planLineageId/);
  });

  it.each([
    ["planId", { ...samplePlan, planId: "" }],
    ["status", { ...samplePlan, status: undefined as unknown as PlanView["status"] }],
    ["steps", { ...samplePlan, steps: undefined as unknown as PlanView["steps"] }],
  ])("names %s when the projected PlanView omits it", async (field, malformed) => {
    const { service } = buildService({
      projection: { project: vi.fn(async () => malformed as PlanView) },
    });
    await expect(service.createPlan(USER_ID, samplePlan.query)).rejects.toThrow(new RegExp(field));
  });
});

describe("OrchestratorPlanService reads + delegation", () => {
  it("projects a single plan by id, scoped to the user", async () => {
    const project = vi.fn(async () => samplePlan);
    const { service } = buildService({ projection: { project } });
    expect(await service.getPlanById(USER_ID, samplePlan.planId)).toEqual(samplePlan);
    expect(project).toHaveBeenCalledWith(samplePlan.planId, USER_ID);
  });

  it("returns null when a plan is not found", async () => {
    const { service } = buildService({ projection: { project: vi.fn(async () => null) } });
    expect(await service.getPlanById(USER_ID, "missing")).toBeNull();
  });

  it("rejects a malformed projection from getPlanById (same guard as createPlan)", async () => {
    const malformed = {
      ...samplePlan,
      status: undefined as unknown as PlanView["status"],
    } as PlanView;
    const { service } = buildService({ projection: { project: vi.fn(async () => malformed) } });
    await expect(service.getPlanById(USER_ID, samplePlan.planId)).rejects.toThrow(
      OrchestratorPlanError,
    );
  });

  it("delegates session, reset, current-plan and transfer to the engine-agnostic delegate", async () => {
    const { service, readDelegate } = buildService();
    const identity = { userId: USER_ID };

    await service.getSession(identity);
    await service.resetDemo(USER_ID);
    await service.getCurrentPlan(USER_ID, samplePlan.planLineageId);
    await service.transferBalance(USER_ID, {
      sourceProgramId: "b001",
      destProgramId: "b002",
      amountPoints: 30000,
    });

    expect(readDelegate.getSession).toHaveBeenCalledWith(identity);
    expect(readDelegate.resetDemo).toHaveBeenCalledWith(USER_ID);
    expect(readDelegate.getCurrentPlan).toHaveBeenCalledWith(USER_ID, samplePlan.planLineageId);
    expect(readDelegate.transferBalance).toHaveBeenCalledOnce();
  });

  it("satisfies the SessionView shape returned by the delegate", async () => {
    const session: SessionView = { userId: USER_ID, clerkId: null, seeded: true };
    const { service } = buildService({
      readDelegate: { getSession: vi.fn(async () => session) },
    });
    expect(await service.getSession({ userId: USER_ID })).toEqual(session);
  });
});

// ──────────────────────────────────────────────
// G1 — Plan projection parity (live PostgreSQL)
// Gated by RUN_LIVE_POSTGRES_TESTS=1; requires a seeded demo-seed-v1 database
// reachable via DATABASE_URL. Uses the REAL production projection wiring
// (composeOrchestratorPlanService → BridgePlanProjection), never a fake.
// ──────────────────────────────────────────────

const LIVE = process.env.RUN_LIVE_POSTGRES_TESTS === "1";
const HERO_QUERY = "What is the best Hyatt redemption for a 3-night Tokyo trip?";

/**
 * Fail fast when the live suites are enabled without a connection string.
 * Without this, `new Pool()` falls back to libpq `PG*` defaults and these live
 * write tests could silently hit the wrong database.
 */
function requireDatabaseUrl(): void {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "RUN_LIVE_POSTGRES_TESTS=1 requires DATABASE_URL; refusing to fall back to libpq PG* defaults",
    );
  }
}

/** Order-insensitive view of a PlanView so parity ignores incidental row order. */
function normalizePlanView(view: PlanView): PlanView {
  return {
    ...view,
    steps: [...view.steps]
      .sort((a, b) => a.order - b.order)
      .map((step) => ({
        ...step,
        dependsOn: [...step.dependsOn].sort(),
        dependencies: [...step.dependencies].sort((x, y) => x.id.localeCompare(y.id)),
      })),
    graph: {
      nodes: [...view.graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
      edges: [...view.graph.edges].sort((a, b) => a.id.localeCompare(b.id)),
    },
  };
}

/** Bridge subprocess plan creation + dual projection reads can exceed vitest's 5s default. */
const LIVE_PG_TIMEOUT_MS = 60_000;

(LIVE ? describe : describe.skip)("G1 — plan projection parity (live-PG)", () => {
  let pool: Pool;
  let bridge: BridgePlanService;
  let orchestratorService: PlanService;

  beforeAll(async () => {
    requireDatabaseUrl();
    const { Pool } = await import("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    bridge = new BridgePlanService();
    // Production wiring: orchestrator engine + BridgePlanProjection over read-plan.
    orchestratorService = composeOrchestratorPlanService({ pool, env: process.env });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("projects an identical PlanView via BridgePlanService (get-plan) and the orchestrator projection (read-plan)", async () => {
    // 1. Persist a known demo Plan through the existing stable bridge path.
    const created = await bridge.createPlan(USER_ID, HERO_QUERY);
    expect(created.planId).toBeTruthy();

    // 2. Read it through the stable bridge service (get-plan → project_plan).
    const viaBridge = await bridge.getPlanById(USER_ID, created.planId);
    // 3. Read it through the orchestrator's production projection (read-plan → project_plan).
    const viaOrchestrator = await orchestratorService.getPlanById(USER_ID, created.planId);

    expect(viaBridge).not.toBeNull();
    expect(viaOrchestrator).not.toBeNull();

    // 4. Compare the complete normalized PlanView.
    expect(normalizePlanView(viaOrchestrator as PlanView)).toEqual(
      normalizePlanView(viaBridge as PlanView),
    );

    // eslint-disable-next-line no-console
    console.log("G1 PLAN PROJECTION PARITY: PASS");
  });

  it("scopes the projection to the owning user (no cross-user read)", async () => {
    const created = await bridge.createPlan(USER_ID, HERO_QUERY);
    const otherUser = "00000000-0000-0000-0000-deadbeef0000";

    const leaked = await orchestratorService.getPlanById(otherUser, created.planId);

    expect(leaked).toBeNull();
  });
}, LIVE_PG_TIMEOUT_MS);

// ──────────────────────────────────────────────
// Phase 5 — service-level initial Plan orchestration (live PostgreSQL)
// Proves OrchestratorPlanService.createPlan() end-to-end: TS orchestrator →
// real snapshot → Wallet → Redemption → Python writes → revision 1 → projection.
// ──────────────────────────────────────────────

const FROZEN_DEMO_QUERY =
  "Book a 3-night Hyatt award stay in Tokyo in October using my points.";

/** Full orchestrator run (2 specialists + multiple Python bridge writes) needs headroom. */
const LIVE_ORCHESTRATOR_TIMEOUT_MS = 120_000;

interface AgentRunRow {
  id: string;
  agent_type: string;
  status: string;
}

(LIVE ? describe : describe.skip)(
  "Phase 5 — service-level initial Plan (live-PG)",
  () => {
    let pool: Pool;
    let service: PlanService;

    beforeAll(async () => {
      requireDatabaseUrl();
      const { Pool } = await import("pg");
      pool = new Pool({ connectionString: process.env.DATABASE_URL });
      service = composeOrchestratorPlanService({ pool, env: process.env });
    });

    afterAll(async () => {
      await pool.end();
    });

    it("createPlan() drives the TS orchestrator through Wallet + Redemption to revision 1", async () => {
      const view = await service.createPlan(USER_ID, FROZEN_DEMO_QUERY);

      expect(view.planId).toBeTruthy();
      expect(view.planLineageId).toBeTruthy();
      expect(view.revisionNumber).toBe(1);
      expect(view.status).toBe("current");
      expect(view.query).toBe(FROZEN_DEMO_QUERY);
      expect(view.steps.length).toBeGreaterThan(0);
      expect(view.graph.nodes.length).toBeGreaterThan(0);

      const planRow = await pool.query<{
        revision_number: number;
        status: string;
        user_id: string;
      }>("SELECT revision_number, status, user_id FROM plans WHERE id = $1", [view.planId]);
      expect(planRow.rows).toHaveLength(1);
      expect(planRow.rows[0]?.revision_number).toBe(1);
      expect(planRow.rows[0]?.status).toBe("current");
      expect(planRow.rows[0]?.user_id).toBe(USER_ID);

      const agentRuns = await pool.query<AgentRunRow>(
        `SELECT id, agent_type, status
         FROM agent_runs
         WHERE plan_id = $1
         ORDER BY started_at ASC`,
        [view.planId],
      );
      const types = agentRuns.rows.map((r) => r.agent_type);
      expect(types).toContain("wallet_agent");
      expect(types).toContain("redemption_agent");
      expect(new Set(types).size).toBeGreaterThanOrEqual(2);
      expect(types.indexOf("wallet_agent")).toBeLessThan(types.indexOf("redemption_agent"));
      for (const row of agentRuns.rows) {
        expect(row.status).toBe("completed");
      }

      const mutations = await pool.query<{ mutation_type: string }>(
        "SELECT mutation_type FROM graph_mutations WHERE plan_id = $1",
        [view.planId],
      );
      expect(mutations.rows.length).toBeGreaterThan(0);

      const dependencies = await pool.query(
        `SELECT sd.id
         FROM state_dependencies sd
         JOIN plan_steps ps ON ps.id = sd.plan_step_id
         WHERE ps.plan_id = $1`,
        [view.planId],
      );
      expect(dependencies.rows.length).toBeGreaterThan(0);

      // eslint-disable-next-line no-console
      console.log(
        "C2 PHASE 5 EVIDENCE:",
        JSON.stringify(
          {
            engine: "orchestrator",
            planId: view.planId,
            planLineageId: view.planLineageId,
            revisionNumber: view.revisionNumber,
            specialistAgentTypes: types,
            agentRunIds: agentRuns.rows.map((r) => r.id),
            mutationCount: mutations.rows.length,
            dependencyCount: dependencies.rows.length,
            stepCount: view.steps.length,
          },
          null,
          2,
        ),
      );
      // eslint-disable-next-line no-console
      console.log("PHASE 5 SERVICE-LEVEL INITIAL PLAN: PASS");
    });
  },
  LIVE_ORCHESTRATOR_TIMEOUT_MS,
);
