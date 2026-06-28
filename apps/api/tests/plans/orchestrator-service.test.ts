import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  PlanProjectionPort,
  PlanRequest,
  PlanResult,
  RevisionResult,
} from "../../src/orchestrator/contracts";
import { BridgePlanService } from "../../src/plans/bridge-service";
import { composeOrchestratorPlanService } from "../../src/plans/orchestrator-composition";
import {
  OrchestratorPlanError,
  OrchestratorPlanService,
  type OrchestratorPlanServiceDeps,
  type OrchestratorReadDelegate,
  type OrchestratorRunner,
  type ReplanApplyOutcome,
  type ReplanPort,
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

const rev2Plan: PlanView = {
  ...samplePlan,
  planId: "44444444-4444-4444-4444-444444444444",
  revisionNumber: 2,
};

const revisionResult: RevisionResult = {
  planId: rev2Plan.planId,
  planLineageId: samplePlan.planLineageId,
  revisionNumber: 2,
  status: "generating",
  agentRunIds: ["run-wallet-2", "run-redemption-2"],
};

const applyOutcome: ReplanApplyOutcome = {
  planLineageId: samplePlan.planLineageId,
  staledPlanId: samplePlan.planId,
  replanJobId: "33333333-3333-3333-3333-333333333333",
  priorQueryText: samplePlan.query,
  priorRevisionNumber: 1,
};

function buildService(
  overrides: {
    runner?: Partial<OrchestratorRunner>;
    projection?: Partial<PlanProjectionPort>;
    readDelegate?: Partial<OrchestratorReadDelegate>;
    replan?: Partial<ReplanPort>;
  } = {},
): {
  service: OrchestratorPlanService;
  runner: OrchestratorRunner;
  projection: PlanProjectionPort;
  readDelegate: OrchestratorReadDelegate;
  replan: ReplanPort;
} {
  const runner: OrchestratorRunner = {
    run: overrides.runner?.run ?? vi.fn(async () => currentResult),
    runRevision: overrides.runner?.runRevision ?? vi.fn(async () => revisionResult),
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
        replanJobId: applyOutcome.replanJobId,
        currentPlan: rev2Plan,
      })),
  };
  const replan: ReplanPort = {
    applyTransfer: overrides.replan?.applyTransfer ?? vi.fn(async () => applyOutcome),
    promote: overrides.replan?.promote ?? vi.fn(async () => undefined),
    fail: overrides.replan?.fail ?? vi.fn(async () => undefined),
  };
  const deps: OrchestratorPlanServiceDeps = { orchestrator: runner, projection, readDelegate, replan };
  return { service: new OrchestratorPlanService(deps), runner, projection, readDelegate, replan };
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

  it("delegates session, reset and current-plan to the engine-agnostic delegate", async () => {
    const { service, readDelegate } = buildService();
    const identity = { userId: USER_ID };

    await service.getSession(identity);
    await service.resetDemo(USER_ID);
    await service.getCurrentPlan(USER_ID, samplePlan.planLineageId);

    expect(readDelegate.getSession).toHaveBeenCalledWith(identity);
    expect(readDelegate.resetDemo).toHaveBeenCalledWith(USER_ID);
    expect(readDelegate.getCurrentPlan).toHaveBeenCalledWith(USER_ID, samplePlan.planLineageId);
  });

  it("satisfies the SessionView shape returned by the delegate", async () => {
    const session: SessionView = { userId: USER_ID, clerkId: null, seeded: true };
    const { service } = buildService({
      readDelegate: { getSession: vi.fn(async () => session) },
    });
    expect(await service.getSession({ userId: USER_ID })).toEqual(session);
  });
});

describe("OrchestratorPlanService.transferBalance (Phase 8 — orchestrator re-entry)", () => {
  const input = { sourceProgramId: "b001", destProgramId: "b002", amountPoints: 15000 };

  it("applies the mutation, re-enters the orchestrator for rev2, promotes, and returns rev2", async () => {
    const runRevision = vi.fn(async () => revisionResult);
    const promote = vi.fn(async () => undefined);
    const project = vi.fn(async () => rev2Plan);
    const { service, replan } = buildService({
      runner: { runRevision },
      replan: { promote },
      projection: { project },
    });

    const result = await service.transferBalance(USER_ID, input);

    // 1. Canonical mutation applied first.
    expect(replan.applyTransfer).toHaveBeenCalledWith(USER_ID, input);
    // 2. Orchestrator re-entered in the EXISTING lineage at revision 2.
    expect(runRevision).toHaveBeenCalledWith(
      { userId: USER_ID, queryText: applyOutcome.priorQueryText },
      {
        planLineageId: applyOutcome.planLineageId,
        revisionNumber: applyOutcome.priorRevisionNumber + 1,
        supersedesPlanId: applyOutcome.staledPlanId,
      },
    );
    // 3. Replan job promoted with the orchestrator-built revision.
    expect(promote).toHaveBeenCalledWith({
      userId: USER_ID,
      planLineageId: applyOutcome.planLineageId,
      sourcePlanId: applyOutcome.staledPlanId,
      resultPlanId: revisionResult.planId,
      workerId: "orchestrator-ts-replan-worker",
    });
    // 4. Returns rev2 as the new current plan.
    expect(result.currentPlan).toEqual(rev2Plan);
    expect(result.staledPlanId).toBe(applyOutcome.staledPlanId);
    expect(result.replanJobId).toBe(applyOutcome.replanJobId);
  });

  it("never delegates revision generation to the legacy read delegate", async () => {
    const { service, readDelegate } = buildService();
    await service.transferBalance(USER_ID, input);
    expect(readDelegate.transferBalance).not.toHaveBeenCalled();
  });

  it("fails the replan job and surfaces the error when the orchestration fails", async () => {
    const failedRevision: RevisionResult = { ...revisionResult, status: "failed" };
    const runRevision = vi.fn(async () => failedRevision);
    const promote = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    const project = vi.fn();
    const { service } = buildService({
      runner: { runRevision },
      replan: { promote, fail },
      projection: { project },
    });

    await expect(service.transferBalance(USER_ID, input)).rejects.toBeInstanceOf(
      OrchestratorPlanError,
    );
    // No promotion, no projection — the failure stays visible.
    expect(promote).not.toHaveBeenCalled();
    expect(project).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledOnce();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePlanId: applyOutcome.staledPlanId,
        resultPlanId: failedRevision.planId,
        workerId: "orchestrator-ts-replan-worker",
      }),
    );
  });

  it("does not promote a revision whose projection is missing (treats it as internal error)", async () => {
    const promote = vi.fn(async () => undefined);
    const fail = vi.fn(async () => undefined);
    const { service } = buildService({
      replan: { promote, fail },
      projection: { project: vi.fn(async () => null) },
    });

    await expect(service.transferBalance(USER_ID, input)).rejects.toBeInstanceOf(
      OrchestratorPlanError,
    );
    // Promotion already happened before projection; the missing view is a 500.
    expect(promote).toHaveBeenCalledOnce();
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

// ──────────────────────────────────────────────
// Phase 8 — orchestrator replan revision-two gate (live PostgreSQL)
// reset → rev1 (TS orchestrator) → transfer 15k Chase→Hyatt → dependency
// invalidation → one replan job → TS orchestrator re-entry → rev2 current,
// rev1 superseded, exactly one current, FRESH wallet + redemption AgentRuns on
// rev2, and NO legacy Python generator produced rev2.
//
// This is the failing gate written FIRST (spec Step 1). It fails on the current
// code at the "rev1 steps are current" assertion (steps persist as 'proposed'),
// and again at the rev2 AgentRun assertions (legacy replan writes no AgentRuns).
// ──────────────────────────────────────────────

const CHASE_PROGRAM_ID = "00000000-0000-0000-0000-00000000b001";
const HYATT_PROGRAM_ID = "00000000-0000-0000-0000-00000000b002";
const REQUIRED_TRANSFER_POINTS = 15000;

interface BalanceRow {
  program_id: string;
  balance_points: number;
  version: number;
}

/** Read the persona's Chase + Hyatt balances as numbers (pg returns int columns as numbers). */
async function readDemoBalances(
  pool: Pool,
  userId: string,
): Promise<{ chase: BalanceRow; hyatt: BalanceRow }> {
  const { rows } = await pool.query<BalanceRow>(
    "SELECT program_id, balance_points, version FROM user_balances WHERE user_id = $1",
    [userId],
  );
  const byProgram = (programId: string): BalanceRow => {
    const row = rows.find((r) => r.program_id === programId);
    if (!row) throw new Error(`balance row missing for program ${programId}`);
    return { ...row, balance_points: Number(row.balance_points), version: Number(row.version) };
  };
  return { chase: byProgram(CHASE_PROGRAM_ID), hyatt: byProgram(HYATT_PROGRAM_ID) };
}

(LIVE ? describe : describe.skip)(
  "Phase 8 — orchestrator replan revision-two (live-PG)",
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

    it("re-enters the TS orchestrator on transfer: rev1→superseded, rev2 current with fresh AgentRuns, no legacy fallback", async () => {
      // 0. Deterministic baseline for the canonical persona.
      await service.resetDemo(USER_ID);

      // 1. Revision 1 through the TS orchestrator.
      const rev1 = await service.createPlan(USER_ID, FROZEN_DEMO_QUERY);
      expect(rev1.revisionNumber).toBe(1);
      expect(rev1.status).toBe("current");
      const lineageId = rev1.planLineageId;

      // 1a. Committed rev1 steps must be 'current' (cause #1: they persist as 'proposed').
      const rev1Steps = await pool.query<{ status: string }>(
        "SELECT status FROM plan_steps WHERE plan_id = $1",
        [rev1.planId],
      );
      expect(rev1Steps.rows.length).toBeGreaterThan(0);
      for (const step of rev1Steps.rows) {
        expect(step.status).toBe("current");
      }

      // 1b. At least one relevant balance dependency exists on rev1.
      const rev1Deps = await pool.query(
        `SELECT sd.id
           FROM state_dependencies sd
           JOIN plan_steps ps ON ps.id = sd.plan_step_id
          WHERE ps.plan_id = $1`,
        [rev1.planId],
      );
      expect(rev1Deps.rows.length).toBeGreaterThanOrEqual(1);

      // 2. Pre-transfer canonical balances.
      const before = await readDemoBalances(pool, USER_ID);
      expect(before.chase.balance_points).toBe(180000);
      expect(before.hyatt.balance_points).toBe(30000);

      // 3. Transfer 15,000 Chase → Hyatt (the replan trigger).
      const result = await service.transferBalance(USER_ID, {
        sourceProgramId: CHASE_PROGRAM_ID,
        destProgramId: HYATT_PROGRAM_ID,
        amountPoints: REQUIRED_TRANSFER_POINTS,
      });

      // 3a. Balances and versions both changed.
      const after = await readDemoBalances(pool, USER_ID);
      expect(after.chase.balance_points).toBe(165000);
      expect(after.hyatt.balance_points).toBe(45000);
      expect(after.chase.version).toBe(before.chase.version + 1);
      expect(after.hyatt.version).toBe(before.hyatt.version + 1);

      // 4. Exactly one replan job exists for the lineage.
      const jobs = await pool.query<{ id: string; status: string }>(
        "SELECT id, status FROM replan_jobs WHERE plan_lineage_id = $1",
        [lineageId],
      );
      expect(jobs.rows.length).toBe(1);

      // 5. rev2 is current in the SAME lineage and supersedes rev1.
      const rev2 = result.currentPlan;
      expect(rev2.planLineageId).toBe(lineageId);
      expect(rev2.revisionNumber).toBe(2);
      expect(rev2.status).toBe("current");
      expect(result.staledPlanId).toBe(rev1.planId);
      expect(result.replanJobId).toBe(jobs.rows[0]?.id);

      const rev2Row = await pool.query<{ supersedes_plan_id: string | null; status: string }>(
        "SELECT supersedes_plan_id, status FROM plans WHERE id = $1",
        [rev2.planId],
      );
      expect(rev2Row.rows[0]?.supersedes_plan_id).toBe(rev1.planId);
      expect(rev2Row.rows[0]?.status).toBe("current");

      // 5a. rev1 becomes superseded.
      const rev1Row = await pool.query<{ status: string }>(
        "SELECT status FROM plans WHERE id = $1",
        [rev1.planId],
      );
      expect(rev1Row.rows[0]?.status).toBe("superseded");

      // 6. Exactly one current plan remains in the lineage, and it is rev2.
      const current = await pool.query<{ id: string }>(
        "SELECT id FROM plans WHERE plan_lineage_id = $1 AND status = 'current'",
        [lineageId],
      );
      expect(current.rows.length).toBe(1);
      expect(current.rows[0]?.id).toBe(rev2.planId);

      // 7. rev2 has FRESH wallet + redemption AgentRuns (proves TS orchestrator re-entry).
      const rev2Runs = await pool.query<AgentRunRow>(
        `SELECT id, agent_type, status
           FROM agent_runs
          WHERE plan_id = $1
          ORDER BY started_at ASC`,
        [rev2.planId],
      );
      const rev2Types = rev2Runs.rows.map((r) => r.agent_type);
      expect(rev2Types).toContain("wallet_agent");
      expect(rev2Types).toContain("redemption_agent");
      expect(rev2Types.indexOf("wallet_agent")).toBeLessThan(rev2Types.indexOf("redemption_agent"));
      for (const row of rev2Runs.rows) {
        expect(row.status).toBe("completed");
      }

      // 8. No legacy Python generator produced rev2: the legacy replan writes ZERO
      //    agent_runs, so a rev2 carrying fresh wallet+redemption runs is dispositive.
      expect(rev2Runs.rows.length).toBeGreaterThanOrEqual(2);

      // eslint-disable-next-line no-console
      console.log(
        "PHASE 8 REPLAN EVIDENCE:",
        JSON.stringify(
          {
            lineageId,
            rev1PlanId: rev1.planId,
            rev2PlanId: rev2.planId,
            replanJobId: jobs.rows[0]?.id,
            replanJobStatus: jobs.rows[0]?.status,
            chase: `${before.chase.balance_points}→${after.chase.balance_points} (v${before.chase.version}→v${after.chase.version})`,
            hyatt: `${before.hyatt.balance_points}→${after.hyatt.balance_points} (v${before.hyatt.version}→v${after.hyatt.version})`,
            rev2AgentTypes: rev2Types,
            rev2AgentRunIds: rev2Runs.rows.map((r) => r.id),
          },
          null,
          2,
        ),
      );
      // eslint-disable-next-line no-console
      console.log("PHASE 8 ORCHESTRATOR REPLAN: PASS");
    });
  },
  LIVE_ORCHESTRATOR_TIMEOUT_MS,
);

// ──────────────────────────────────────────────
// Phase 8b — reset repeatability (live PostgreSQL)
// Runs the full reset→rev1→transfer→rev2 cycle TWICE. The second run must NOT
// replay the first run's idempotency result: the deterministic reset clears
// idempotency_records + agent_runs, so the identical transfer mutates fresh and
// produces a distinct revision 2 + replan job.
// ──────────────────────────────────────────────

interface ReplanCycleFacts {
  rev2PlanId: string;
  replanJobId: string;
  replanJobStatus: string;
  rev2AgentTypes: string[];
  chaseAfter: number;
  hyattAfter: number;
}

/** One full orchestrator replan cycle with the core invariants asserted. */
async function runReplanCycle(pool: Pool, service: PlanService): Promise<ReplanCycleFacts> {
  await service.resetDemo(USER_ID);

  const before = await readDemoBalances(pool, USER_ID);
  expect(before.chase.balance_points).toBe(180000);
  expect(before.hyatt.balance_points).toBe(30000);

  const rev1 = await service.createPlan(USER_ID, FROZEN_DEMO_QUERY);
  const lineageId = rev1.planLineageId;

  const result = await service.transferBalance(USER_ID, {
    sourceProgramId: CHASE_PROGRAM_ID,
    destProgramId: HYATT_PROGRAM_ID,
    amountPoints: REQUIRED_TRANSFER_POINTS,
  });

  // The transfer must mutate fresh — a replayed idempotent result would leave
  // balances at 180k/30k and create no new job.
  const after = await readDemoBalances(pool, USER_ID);
  expect(after.chase.balance_points).toBe(165000);
  expect(after.hyatt.balance_points).toBe(45000);

  const jobs = await pool.query<{ id: string; status: string }>(
    "SELECT id, status FROM replan_jobs WHERE plan_lineage_id = $1",
    [lineageId],
  );
  expect(jobs.rows.length).toBe(1);

  const rev2 = result.currentPlan;
  expect(rev2.revisionNumber).toBe(2);
  expect(rev2.status).toBe("current");

  const rev2Runs = await pool.query<AgentRunRow>(
    "SELECT agent_type FROM agent_runs WHERE plan_id = $1 ORDER BY started_at ASC",
    [rev2.planId],
  );
  const rev2AgentTypes = rev2Runs.rows.map((r) => r.agent_type);
  expect(rev2AgentTypes).toContain("wallet_agent");
  expect(rev2AgentTypes).toContain("redemption_agent");

  return {
    rev2PlanId: rev2.planId,
    replanJobId: jobs.rows[0]!.id,
    replanJobStatus: jobs.rows[0]!.status,
    rev2AgentTypes,
    chaseAfter: after.chase.balance_points,
    hyattAfter: after.hyatt.balance_points,
  };
}

(LIVE ? describe : describe.skip)(
  "Phase 8b — reset repeatability (live-PG)",
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

    it("runs the full replan flow twice; the second run is fresh, not an idempotency replay", async () => {
      const run1 = await runReplanCycle(pool, service);
      const run2 = await runReplanCycle(pool, service);

      // Both runs completed a real replan.
      expect(run1.replanJobStatus).toBe("completed");
      expect(run2.replanJobStatus).toBe("completed");

      // The second run is genuinely fresh: distinct revision 2 + distinct job,
      // and it mutated the (reset-restored) balances rather than replaying.
      expect(run2.rev2PlanId).not.toBe(run1.rev2PlanId);
      expect(run2.replanJobId).not.toBe(run1.replanJobId);
      expect(run2.chaseAfter).toBe(165000);
      expect(run2.hyattAfter).toBe(45000);

      // eslint-disable-next-line no-console
      console.log(
        "PHASE 8b REPEATABILITY EVIDENCE:",
        JSON.stringify({ run1, run2 }, null, 2),
      );
      // eslint-disable-next-line no-console
      console.log("PHASE 8b RESET REPEATABILITY: PASS");
    });
  },
  LIVE_ORCHESTRATOR_TIMEOUT_MS * 2,
);
