import { describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { createApp, type AppDeps } from "./app";
import type { PlanService } from "./plans/service";

const DEV_USER = "00000000-0000-0000-0000-00000000a001";

/**
 * Build the full app with a dev-bypass identity so requests resolve to a user
 * without Clerk. The PlanService is never invoked by `/balances`, and the pool
 * is only touched by routes we don't hit here, so both are minimal stubs.
 */
function buildApp() {
  const deps: AppDeps = {
    planEngine: "python-legacy",
    planService: {} as PlanService,
    pool: { query: async () => ({ rows: [] }) } as unknown as Pool,
    corsOrigin: "http://localhost:3000",
    auth: { allowDevBypass: true, devUserId: DEV_USER },
  };
  return createApp(deps);
}

function postJson(path: string, body: unknown) {
  return new Request(`http://local${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("createApp wiring", () => {
  it("mounts the balances route so POST /balances is reachable through the app", async () => {
    const app = buildApp();
    const res = await app.request(
      postJson("/balances", { balances: [{ programId: "p1", points: 120000 }] }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: DEV_USER,
      balances: [{ programId: "p1", points: 120000 }],
    });
  });

  it("still serves /health (mount order regression guard)", async () => {
    const app = buildApp();
    const res = await app.request("http://local/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, engine: "python-legacy" });
  });
});
