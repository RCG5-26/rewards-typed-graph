import type { Pool } from "pg";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type AuthEnv } from "../../src/http/auth";
import { bootPlanService } from "../../src/plans/engine-selector";
import { createPlanRoutes } from "../../src/plans/routes";
import type { PlanView } from "../../src/plans/types";

const LIVE = process.env.RUN_LIVE_POSTGRES_TESTS === "1";
const USER_ID = "00000000-0000-0000-0000-00000000a001";
const FROZEN_DEMO_QUERY =
  "Book a 3-night Hyatt award stay in Tokyo in October using my points.";
const LIVE_ORCHESTRATOR_TIMEOUT_MS = 120_000;

function postJson(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

(LIVE ? describe : describe.skip)("POST /plans — orchestrator route (live-PG)", () => {
  let pool: Pool;
  let app: Hono<AuthEnv>;

  beforeAll(async () => {
    const { Pool } = await import("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const env = { ...process.env, PLAN_ENGINE: "orchestrator" as const };
    const { service } = bootPlanService(env, { pool });

    app = new Hono<AuthEnv>();
    app.use("*", async (c, next) => {
      c.set("userId", USER_ID);
      await next();
    });
    app.route("/", createPlanRoutes(service));
  });

  afterAll(async () => {
    await pool.end();
  });

  it("POST /plans reaches the orchestrator engine and returns a revision-1 PlanView", async () => {
    const res = await app.request(
      postJson("/plans", {
        query: FROZEN_DEMO_QUERY,
        cardSlugs: ["card:world_of_hyatt"],
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as PlanView;
    expect(body.revisionNumber).toBe(1);
    expect(body.status).toBe("current");
    expect(body.steps.length).toBeGreaterThan(0);

    const agentRuns = await pool.query<{ agent_type: string }>(
      `SELECT agent_type FROM agent_runs WHERE plan_id = $1 ORDER BY started_at`,
      [body.planId],
    );
    const types = new Set(agentRuns.rows.map((r) => r.agent_type));
    expect(types.has("wallet_agent")).toBe(true);
    expect(types.has("redemption_agent")).toBe(true);

    // eslint-disable-next-line no-console
    console.log("PHASE 6 ROUTE-LEVEL INITIAL PLAN: PASS");
  });

  it("reset + second POST /plans both succeed (go/no-go consecutive run)", async () => {
    const reset = await app.request(postJson("/demo/reset", {}));
    expect(reset.status).toBe(200);

    const first = await app.request(postJson("/plans", { query: FROZEN_DEMO_QUERY }));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as PlanView;

    const second = await app.request(postJson("/plans", { query: FROZEN_DEMO_QUERY }));
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as PlanView;

    expect(firstBody.planId).not.toBe(secondBody.planId);
    expect(firstBody.revisionNumber).toBe(1);
    expect(secondBody.revisionNumber).toBe(1);

    // eslint-disable-next-line no-console
    console.log("PHASE 7 RESET + SECOND RUN: PASS");
  });
}, LIVE_ORCHESTRATOR_TIMEOUT_MS);
