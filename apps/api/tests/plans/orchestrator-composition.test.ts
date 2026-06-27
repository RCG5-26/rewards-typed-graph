import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import type { PlanProjectionPort, PlanResult } from "../../src/orchestrator/contracts";
import {
  AdaptersNotIntegratedError,
  EXPECTED_PROMPT_B_HANDOFF,
  composeOrchestratorPlanService,
} from "../../src/plans/orchestrator-composition";
import { OrchestratorPlanService } from "../../src/plans/orchestrator-service";
import type { PlanView } from "../../src/plans/types";

const COMPOSITION_SOURCE = fileURLToPath(
  new URL("../../src/plans/orchestrator-composition.ts", import.meta.url),
);

describe("composeOrchestratorPlanService (Phase 4 — production composition root)", () => {
  it("fails fast at the C1 stop gate without fabricating adapters", () => {
    expect(() => composeOrchestratorPlanService()).toThrow(AdaptersNotIntegratedError);
  });

  it("names the expected Prompt B handoff in the fail-fast message", () => {
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
