/**
 * Boot → /health engine contract (M5 / ADR 0010 §3).
 *
 * server.ts selects the plan engine once at boot and surfaces it on /health.
 * These tests exercise the real bootPlanService → createApp wiring (no mocks of
 * the selector) so the boot/health contract cannot drift silently.
 */

import { describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { createApp } from "../src/app";
import { bootPlanService } from "../src/plans/engine-selector";

// /health never touches the pool (no Authorization header → no clerk lookup),
// and neither engine connects at construction; a stub pool is sufficient.
const fakePool = {
  query: async () => ({ rows: [] }),
} as unknown as Pool;

function bootApp(planEngine: string) {
  const booted = bootPlanService({ PLAN_ENGINE: planEngine } as NodeJS.ProcessEnv, {
    pool: fakePool,
  });
  const app = createApp({
    planEngine: booted.engine,
    planService: booted.service,
    pool: fakePool,
    corsOrigin: "http://localhost:3000",
    auth: { allowDevBypass: false },
  });
  return { app, booted };
}

describe("createApp — /health boot contract", () => {
  it("reports the selected engine when booted with PLAN_ENGINE=python-legacy", async () => {
    const { app, booted } = bootApp("python-legacy");

    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, engine: "python-legacy" });
    expect(booted.engine).toBe("python-legacy");
  });

  it("reports the selected engine when booted with PLAN_ENGINE=orchestrator", async () => {
    const { app, booted } = bootApp("orchestrator");

    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, engine: "orchestrator" });
    expect(booted.engine).toBe("orchestrator");
  });
});
