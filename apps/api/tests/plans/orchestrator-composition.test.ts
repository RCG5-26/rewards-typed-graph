import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { PlanProjectionPort, PlanResult } from "../../src/orchestrator/contracts";
import {
  AdaptersNotIntegratedError,
  EXPECTED_PROMPT_B_HANDOFF,
  buildProductionOrchestratorDeps,
  composeOrchestratorPlanService,
} from "../../src/plans/orchestrator-composition";
import { OrchestratorPlanService } from "../../src/plans/orchestrator-service";
import type { PlanView } from "../../src/plans/types";

// The snapshot builder stores the pool but issues no query at construction time,
// so a bare object is a safe stand-in for assembling (not running) the engine.
const fakePool = {} as Pool;

const COMPOSITION_SOURCE = fileURLToPath(
  new URL("../../src/plans/orchestrator-composition.ts", import.meta.url),
);

describe("composeOrchestratorPlanService (Phase 4 — production composition root)", () => {
  it("fails fast without fabricating adapters when no pool and no deps are given", () => {
    expect(() => composeOrchestratorPlanService()).toThrow(AdaptersNotIntegratedError);
  });

  it("names the production handoff and the python-legacy rollback in the fail-fast message", () => {
    try {
      composeOrchestratorPlanService({ env: {} });
      expect.unreachable("should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/python-legacy/);
      for (const item of EXPECTED_PROMPT_B_HANDOFF) {
        expect(message).toContain(item);
      }
    }
  });

  it("assembles a production OrchestratorPlanService when a Postgres pool is provided", () => {
    const service = composeOrchestratorPlanService({ pool: fakePool, env: {} });
    expect(service).toBeInstanceOf(OrchestratorPlanService);
  });

  it("wires real M6 deps (orchestrator runner + projection + read delegate) from a pool", () => {
    const deps = buildProductionOrchestratorDeps({ pool: fakePool, env: {} });
    expect(typeof deps.orchestrator.run).toBe("function");
    expect(typeof deps.projection.project).toBe("function");
    expect(typeof deps.readDelegate.transferBalance).toBe("function");
  });

  it("builds a real OrchestratorPlanService when post-handoff deps are injected", () => {
    const samplePlan: PlanView = {
      planId: "p1",
      planLineageId: "l1",
      revisionNumber: 1,
      status: "current",
      query: "q",
      summary: null,
      steps: [],
      graph: { nodes: [], edges: [] },
    };
    const result: PlanResult = {
      planId: "p1",
      planLineageId: "l1",
      status: "current",
      agentRunIds: [],
    };
    const projection: PlanProjectionPort = { project: vi.fn(async () => samplePlan) };

    const service = composeOrchestratorPlanService({
      deps: {
        orchestrator: { run: vi.fn(async () => result) },
        projection,
        readDelegate: {
          getSession: vi.fn(),
          resetDemo: vi.fn(),
          getCurrentPlan: vi.fn(),
          transferBalance: vi.fn(),
        },
      },
    });

    expect(service).toBeInstanceOf(OrchestratorPlanService);
  });

  it("imports no test double or fixture into the production composition source", () => {
    const source = readFileSync(COMPOSITION_SOURCE, "utf8");
    expect(source).not.toMatch(/tests\/helpers/);
    expect(source).not.toMatch(/InMemory/);
    expect(source).not.toMatch(/Stub|Fake/);
    expect(source).not.toMatch(/fixtures\//);
  });
});
