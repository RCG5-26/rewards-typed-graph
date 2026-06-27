import { describe, expect, it, vi } from "vitest";

import type { PlanProjectionPort, PlanRequest, PlanResult } from "../../src/orchestrator/contracts";
import {
  OrchestratorPlanError,
  OrchestratorPlanService,
  type OrchestratorPlanServiceDeps,
  type OrchestratorReadDelegate,
  type OrchestratorRunner,
} from "../../src/plans/orchestrator-service";
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
