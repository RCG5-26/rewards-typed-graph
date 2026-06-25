import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { type AuthEnv } from "../http/auth";
import { createPlanRoutes } from "./routes";
import { PlanServiceError, type PlanService } from "./service";
import {
  type BalanceTransferInput,
  type BalanceTransferResult,
  type PlanView,
  type SessionView,
} from "./types";

const USER_ID = "00000000-0000-0000-0000-000000000002";

const samplePlan: PlanView = {
  planId: "11111111-1111-1111-1111-111111111111",
  planLineageId: "22222222-2222-2222-2222-222222222222",
  revisionNumber: 1,
  status: "current",
  query: "Best way to get to Tokyo in October?",
  summary: "Transfer to Hyatt, book the Park Hyatt.",
  steps: [
    {
      order: 1,
      type: "transfer_recommendation",
      summary: "Transfer 60,000 Chase points to Hyatt.",
      reasoning: "1:1 transfer path covers the award.",
      status: "current",
      dependsOn: ["balance-node-1"],
    },
  ],
};

function createFakeService(overrides: Partial<PlanService> = {}): PlanService {
  const base: PlanService = {
    async getSession(identity) {
      const userId = identity.userId ?? "bootstrapped-user-id";
      return {
        userId,
        clerkId: identity.clerkId ?? "clerk_demo",
        seeded: true,
      } satisfies SessionView;
    },
    async resetDemo(userId) {
      return { userId, clerkId: "clerk_demo", seeded: true } satisfies SessionView;
    },
    async createPlan() {
      return samplePlan;
    },
    async getPlanById(_userId, planId) {
      return planId === samplePlan.planId ? samplePlan : null;
    },
    async getCurrentPlan(_userId, lineageId) {
      return lineageId === samplePlan.planLineageId ? samplePlan : null;
    },
    async transferBalance(_userId, _input: BalanceTransferInput) {
      return {
        planLineageId: samplePlan.planLineageId,
        staledPlanId: samplePlan.planId,
        replanJobId: "33333333-3333-3333-3333-333333333333",
        currentPlan: { ...samplePlan, revisionNumber: 2 },
      } satisfies BalanceTransferResult;
    },
  };
  return { ...base, ...overrides };
}

function createTestApp(
  service: PlanService,
  options: { injectUserId?: boolean; injectClerkId?: string } = {},
) {
  const { injectUserId = true, injectClerkId } = options;
  const app = new Hono<AuthEnv>();
  if (injectUserId || injectClerkId) {
    app.use("*", async (c, next) => {
      if (injectUserId) {
        c.set("userId", USER_ID);
      }
      if (injectClerkId) {
        c.set("clerkId", injectClerkId);
      }
      await next();
    });
  }
  app.route("/", createPlanRoutes(service));
  return app;
}

function postJson(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("plan routes", () => {
  it("returns the seeded session", async () => {
    const app = createTestApp(createFakeService());
    const res = await app.request("/session");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: USER_ID,
      clerkId: "clerk_demo",
      seeded: true,
    });
  });

  it("rejects unauthenticated requests with 401", async () => {
    const app = createTestApp(createFakeService(), { injectUserId: false });
    const res = await app.request("/session");
    expect(res.status).toBe(401);
  });

  it("bootstraps a session from a clerkId alone (new user, no userId)", async () => {
    const app = createTestApp(createFakeService(), {
      injectUserId: false,
      injectClerkId: "user_new_clerk_sub",
    });
    const res = await app.request("/session");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; clerkId: string };
    expect(body.userId).toBe("bootstrapped-user-id");
    expect(body.clerkId).toBe("user_new_clerk_sub");
  });

  it("creates a plan synchronously and returns the full body", async () => {
    const app = createTestApp(createFakeService());
    const res = await app.request(postJson("/plans", { query: "Tokyo in October?" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(samplePlan);
  });

  it("rejects an empty query with 400", async () => {
    const app = createTestApp(createFakeService());
    const res = await app.request(postJson("/plans", { query: "   " }));
    expect(res.status).toBe(400);
  });

  it("returns a plan by id and 404 for unknown ids", async () => {
    const app = createTestApp(createFakeService());
    const ok = await app.request(`/plans/${samplePlan.planId}`);
    expect(ok.status).toBe(200);
    const missing = await app.request("/plans/does-not-exist");
    expect(missing.status).toBe(404);
  });

  it("requires lineageId for the current-plan route", async () => {
    const app = createTestApp(createFakeService());
    const res = await app.request("/plans/current");
    expect(res.status).toBe(400);
  });

  it("returns the current plan for a known lineage", async () => {
    const app = createTestApp(createFakeService());
    const res = await app.request(
      `/plans/current?lineageId=${samplePlan.planLineageId}`,
    );
    expect(res.status).toBe(200);
  });

  it("re-plans on balance transfer and returns revision 2", async () => {
    const app = createTestApp(createFakeService());
    const res = await app.request(
      postJson("/balance-transfer", {
        sourceProgramId: "prog-a",
        destProgramId: "prog-b",
        amountPoints: 5000,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as BalanceTransferResult;
    expect(body.currentPlan.revisionNumber).toBe(2);
  });

  it("rejects a transfer with equal source and dest with 400", async () => {
    const app = createTestApp(createFakeService());
    const res = await app.request(
      postJson("/balance-transfer", {
        sourceProgramId: "prog-a",
        destProgramId: "prog-a",
        amountPoints: 5000,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a non-positive transfer amount with 400", async () => {
    const app = createTestApp(createFakeService());
    const res = await app.request(
      postJson("/balance-transfer", {
        sourceProgramId: "prog-a",
        destProgramId: "prog-b",
        amountPoints: 0,
      }),
    );
    expect(res.status).toBe(400);
  });

  it("maps a conflict from the service to 409", async () => {
    const app = createTestApp(
      createFakeService({
        async transferBalance() {
          throw new PlanServiceError("conflict", "insufficient balance");
        },
      }),
    );
    const res = await app.request(
      postJson("/balance-transfer", {
        sourceProgramId: "prog-a",
        destProgramId: "prog-b",
        amountPoints: 999999,
      }),
    );
    expect(res.status).toBe(409);
  });

  it("maps a not_found program from the service to 404", async () => {
    const app = createTestApp(
      createFakeService({
        async transferBalance() {
          throw new PlanServiceError("not_found", "unknown program");
        },
      }),
    );
    const res = await app.request(
      postJson("/balance-transfer", {
        sourceProgramId: "prog-a",
        destProgramId: "prog-b",
        amountPoints: 5000,
      }),
    );
    expect(res.status).toBe(404);
  });

  it("resets the demo persona", async () => {
    const app = createTestApp(createFakeService());
    const res = await app.request(postJson("/demo/reset", {}));
    expect(res.status).toBe(200);
  });
});
