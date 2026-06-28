import { describe, expect, it } from "vitest";

import { CANONICAL_QUERY } from "./canonical-wallet";
import type { GraphPlanRunner } from "./adapters/graph-orchestrator";
import type { BaselineModule, BaselineReport, RunBaselineReport } from "./adapters/baseline-bridge";
import { createComparisonRoutes } from "./routes";
import type { ComparisonDeps } from "./run-comparison";
import type { ArchitectureComparisonResponse } from "./types";
import type { PlanView } from "../plans/types";

const GINZA_SLUG = "award:demo_hyatt_ginza:tokyo:3n";
const CHASE = "00000000-0000-0000-0000-00000000b001";
const HYATT = "00000000-0000-0000-0000-00000000b002";

function graphView(): PlanView {
  return {
    planId: "plan-1",
    planLineageId: "lineage-1",
    revisionNumber: 1,
    status: "current",
    query: CANONICAL_QUERY,
    summary: "Transfer Chase to Hyatt, then redeem Ginza.",
    steps: [
      {
        order: 1,
        type: "redemption_recommendation",
        summary: "Redeem the Ginza award",
        reasoning: "Best value.",
        status: "current",
        dependsOn: [],
        dependencies: [],
      },
    ],
    graph: {
      nodes: [
        { id: "n-chase", kind: "program", slug: "program:chase_ur", label: "Chase", programId: CHASE },
        { id: "n-hyatt", kind: "program", slug: "program:hyatt", label: "Hyatt", programId: HYATT },
        { id: "n-award", kind: "redemption", slug: GINZA_SLUG, label: "Ginza", programId: HYATT },
      ],
      edges: [
        { id: "e1", from: "n-chase", to: "n-hyatt", kind: "transfer" },
        { id: "e2", from: "n-hyatt", to: "n-award", kind: "redeem" },
      ],
    },
  };
}

const graphService: GraphPlanRunner = { createPlan: async () => graphView() };

function baselineReport(architecture: string): BaselineReport {
  return {
    architecture,
    cases: [
      {
        token_cost_total: 2050,
        status: "current",
        actual_top_award_slug: GINZA_SLUG,
        baseline_plan_record: {
          raw_output: {
            status: "current",
            chosen_award_slug: GINZA_SLUG,
            ranked_awards: [{ award_slug: GINZA_SLUG }],
            steps: [
              { summary: "Transfer 15,000 Chase to World of Hyatt", reasoning: "Gap." },
              { summary: "Redeem Ginza", reasoning: "Value." },
            ],
          },
        },
      },
    ],
  };
}

const happyReport: RunBaselineReport = async (module) => baselineReport(module);

function deps(overrides: Partial<ComparisonDeps> = {}): ComparisonDeps {
  return { graphService, runReport: happyReport, env: {}, ...overrides };
}

async function postComparison(d: ComparisonDeps, body: unknown) {
  const app = createComparisonRoutes(d);
  return app.request("/demo/architecture-comparison", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /demo/architecture-comparison", () => {
  it("returns three independent results in a single response", async () => {
    const response = await postComparison(deps(), { walletId: "transfer-required" });
    expect(response.status).toBe(200);
    const json = (await response.json()) as ArchitectureComparisonResponse;

    expect(json.walletId).toBe("transfer-required");
    expect(json.walletVersion).toBe("demo-seed-v1");
    expect(json.query).toBe(CANONICAL_QUERY);
    expect(json.results.map((r) => r.variant)).toEqual([
      "live-graph-orchestrator",
      "chat-crew",
      "single-agent",
    ]);
    for (const result of json.results) {
      expect(result.status).toBe("succeeded");
      expect(result.evaluation).toBeDefined();
      expect(result.evaluation?.goalSatisfied).toBe(true);
      expect(result.query).toBe(CANONICAL_QUERY);
    }
  });

  it("isolates a single architecture failure (partial success, still HTTP 200)", async () => {
    const failChatCrew: RunBaselineReport = async (module: BaselineModule) => {
      if (module === "benchmark.free_text_multiagent_baseline") {
        throw new Error("OPENAI_API_KEY missing");
      }
      return baselineReport(module);
    };
    const response = await postComparison(deps({ runReport: failChatCrew }), {
      walletId: "transfer-required",
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as ArchitectureComparisonResponse;

    const chatCrew = json.results.find((r) => r.variant === "chat-crew");
    const graph = json.results.find((r) => r.variant === "live-graph-orchestrator");
    const single = json.results.find((r) => r.variant === "single-agent");
    expect(chatCrew?.status).toBe("failed");
    expect(chatCrew?.error?.message).toContain("OPENAI_API_KEY");
    expect(graph?.status).toBe("succeeded");
    expect(single?.status).toBe("succeeded");
  });

  it("defaults to the canonical query when none is provided", async () => {
    const response = await postComparison(deps(), { walletId: "transfer-required" });
    const json = (await response.json()) as ArchitectureComparisonResponse;
    expect(json.query).toBe(CANONICAL_QUERY);
  });

  it("rejects an unapproved wallet id with HTTP 400", async () => {
    const response = await postComparison(deps(), { walletId: "not-a-wallet" });
    expect(response.status).toBe(400);
  });

  it("rejects a malformed body with HTTP 400", async () => {
    const app = createComparisonRoutes(deps());
    const response = await app.request("/demo/architecture-comparison", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(response.status).toBe(400);
  });
});
