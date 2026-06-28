import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { BridgePlanService } from "../../src/plans/bridge-service";
import { OrchestratorPlanService } from "../../src/plans/orchestrator-service";
import {
  PLAN_ENGINE_KINDS,
  PlanEngineConfigError,
  bootPlanService,
  createPlanService,
  describePlanEngineSelection,
  parsePlanEngine,
} from "../../src/plans/engine-selector";
import type { PlanService } from "../../src/plans/service";

const noopService = {} as PlanService;

describe("parsePlanEngine (M5 — fail-fast, no silent default)", () => {
  it("accepts the two known engines", () => {
    expect(parsePlanEngine("python-legacy")).toBe("python-legacy");
    expect(parsePlanEngine("orchestrator")).toBe("orchestrator");
  });

  it("trims surrounding whitespace before matching", () => {
    expect(parsePlanEngine("  orchestrator  ")).toBe("orchestrator");
  });

  it("fails fast when the value is missing (ADR 0010 §3 — no implicit default)", () => {
    expect(() => parsePlanEngine(undefined)).toThrow(PlanEngineConfigError);
    expect(() => parsePlanEngine("")).toThrow(PlanEngineConfigError);
    expect(() => parsePlanEngine("   ")).toThrow(PlanEngineConfigError);
  });

  it("fails fast on an unknown value and never silently picks an engine", () => {
    expect(() => parsePlanEngine("python")).toThrow(PlanEngineConfigError);
    expect(() => parsePlanEngine("ORCHESTRATOR")).toThrow(PlanEngineConfigError);
  });

  it("names the valid values in the error so boot logs are actionable", () => {
    try {
      parsePlanEngine("bogus");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PlanEngineConfigError);
      const message = (error as Error).message;
      for (const kind of PLAN_ENGINE_KINDS) {
        expect(message).toContain(kind);
      }
    }
  });
});

describe("describePlanEngineSelection (safe startup evidence)", () => {
  it("reports the engine and that no per-request fallback is allowed", () => {
    expect(describePlanEngineSelection("orchestrator")).toEqual({
      engine: "orchestrator",
      perRequestFallbackAllowed: false,
    });
  });

  it("carries no secret-bearing fields", () => {
    const evidence = describePlanEngineSelection("python-legacy");
    expect(Object.keys(evidence).sort()).toEqual(["engine", "perRequestFallbackAllowed"]);
  });
});

describe("createPlanService (selection without fallback)", () => {
  it("builds exactly the legacy engine for python-legacy", () => {
    const legacy = vi.fn(() => noopService);
    const orchestrator = vi.fn(() => noopService);

    const service = createPlanService("python-legacy", { legacy, orchestrator });

    expect(service).toBe(noopService);
    expect(legacy).toHaveBeenCalledOnce();
    expect(orchestrator).not.toHaveBeenCalled();
  });

  it("builds exactly the orchestrator engine for orchestrator", () => {
    const legacy = vi.fn(() => noopService);
    const orchestrator = vi.fn(() => noopService);

    createPlanService("orchestrator", { legacy, orchestrator });

    expect(orchestrator).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
  });

  it("propagates an orchestrator construction failure with NO fallback to legacy", () => {
    const legacy = vi.fn(() => noopService);
    const orchestrator = vi.fn(() => {
      throw new Error("adapters not integrated");
    });

    expect(() => createPlanService("orchestrator", { legacy, orchestrator })).toThrow(
      "adapters not integrated",
    );
    expect(legacy).not.toHaveBeenCalled();
  });
});

describe("bootPlanService (server.ts boot seam)", () => {
  it("selects the live BridgePlanService under python-legacy", () => {
    const { engine, service, evidence } = bootPlanService({ PLAN_ENGINE: "python-legacy" });

    expect(engine).toBe("python-legacy");
    expect(service).toBeInstanceOf(BridgePlanService);
    expect(evidence).toEqual({ engine: "python-legacy", perRequestFallbackAllowed: false });
  });

  it("fails fast at boot when PLAN_ENGINE is unset", () => {
    expect(() => bootPlanService({})).toThrow(PlanEngineConfigError);
  });

  it("fails fast at boot when PLAN_ENGINE is invalid", () => {
    expect(() => bootPlanService({ PLAN_ENGINE: "nope" })).toThrow(PlanEngineConfigError);
  });

  it("fails explicitly under orchestrator when no Postgres pool is supplied (no fabrication)", () => {
    expect(() => bootPlanService({ PLAN_ENGINE: "orchestrator" })).toThrow(/adapter|pool|database/i);
  });

  it("boots the production orchestrator engine when a Postgres pool is supplied", () => {
    const fakePool = {} as Pool;
    const { engine, service } = bootPlanService(
      { PLAN_ENGINE: "orchestrator" },
      { pool: fakePool },
    );

    expect(engine).toBe("orchestrator");
    expect(service).toBeInstanceOf(OrchestratorPlanService);
  });
});
