import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import { CANONICAL_QUERY } from "./canonical-wallet";
import type { GraphPlanRunner } from "./adapters/graph-orchestrator";
import type { BaselineModule, BaselineReport, RunBaselineReport } from "./adapters/baseline-bridge";
import { createComparisonRoutes } from "./routes";
import type { ComparisonDeps } from "./run-comparison";
import type { ArchitectureComparisonResponse } from "./types";
import type { PlanView } from "../plans/types";
import type { PlanService } from "../plans/service";

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
  return {
    graphService,
    planEngine: "orchestrator",
    replanService: graphService as unknown as PlanService,
    runReport: happyReport,
    env: {},
    ...overrides,
  };
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

  it("accepts the exact canonical query and echoes it to every result (Fix 5)", async () => {
    const response = await postComparison(deps(), {
      walletId: "transfer-required",
      query: CANONICAL_QUERY,
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as ArchitectureComparisonResponse;
    expect(json.query).toBe(CANONICAL_QUERY);
    // The response query must match what every architecture actually ran on.
    for (const result of json.results) {
      expect(result.query).toBe(CANONICAL_QUERY);
    }
  });

  it("rejects any non-canonical query with HTTP 400 (Fix 5: no arbitrary queries)", async () => {
    const response = await postComparison(deps(), {
      walletId: "transfer-required",
      query: "How do I get to the moon on points?",
    });
    expect(response.status).toBe(400);
  });

  it("rejects an empty-string query with HTTP 400 (Fix 5)", async () => {
    const response = await postComparison(deps(), { walletId: "transfer-required", query: "   " });
    expect(response.status).toBe(400);
  });

  it("rejects an unapproved wallet id with HTTP 400", async () => {
    const response = await postComparison(deps(), { walletId: "not-a-wallet" });
    expect(response.status).toBe(400);
  });

  it("exposes canonical public wallet facts (no private gold) via GET", async () => {
    const app = createComparisonRoutes(deps());
    const response = await app.request("/demo/test-wallets");
    expect(response.status).toBe(200);
    const json = (await response.json()) as { wallets: Array<Record<string, unknown>> };
    expect(json.wallets.length).toBeGreaterThan(0);
    const wallet = json.wallets[0];
    expect(wallet.walletId).toBe("transfer-required");
    expect(wallet.balances).toBeDefined();
    expect(wallet.query).toBe(CANONICAL_QUERY);
    // Public facts must not leak any "expected winner"/gold classification.
    expect(JSON.stringify(wallet)).not.toMatch(/expected_top_award|gold|correct_answer|winner/i);
  });

  it("allows the graph variant when PLAN_ENGINE=orchestrator (Fix 2)", async () => {
    const response = await postComparison(deps({ planEngine: "orchestrator" }), {
      walletId: "transfer-required",
    });
    const json = (await response.json()) as ArchitectureComparisonResponse;
    const graph = json.results.find((r) => r.variant === "live-graph-orchestrator");
    expect(graph?.status).toBe("succeeded");
  });

  it("never labels a python-legacy plan as the live graph orchestrator (Fix 2)", async () => {
    // The graph service must NOT be invoked under a non-orchestrator engine.
    const throwingGraph: GraphPlanRunner = {
      createPlan: async () => {
        throw new Error("graph service must not run under python-legacy");
      },
    };
    const response = await postComparison(
      deps({ planEngine: "python-legacy", graphService: throwingGraph }),
      { walletId: "transfer-required" },
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as ArchitectureComparisonResponse;

    const graph = json.results.find((r) => r.variant === "live-graph-orchestrator");
    expect(graph?.status).toBe("failed");
    expect(graph?.error?.category).toBe("engine_configuration_error");
    expect(graph?.plan).toBeUndefined();
    // The other two architectures are unaffected by the engine mismatch.
    expect(json.results.find((r) => r.variant === "chat-crew")?.status).toBe("succeeded");
    expect(json.results.find((r) => r.variant === "single-agent")?.status).toBe("succeeded");
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

describe("POST /demo/simulate-transfer", () => {
  function rev2View(): PlanView {
    return {
      ...graphView(),
      planId: "plan-2",
      revisionNumber: 2,
      summary: "Redeem Ginza with updated Hyatt balance.",
      steps: [
        {
          order: 1,
          type: "redemption_recommendation",
          summary: "Redeem the Ginza award",
          reasoning: "Hyatt balance now covers the award.",
          status: "current",
          dependsOn: [],
          dependencies: [],
        },
      ],
      graph: {
        nodes: graphView().graph.nodes,
        edges: [{ id: "e2", from: "n-hyatt", to: "n-award", kind: "redeem" }],
      },
    };
  }

  const replanService: PlanService = {
    getSession: async () => ({ userId: "u", clerkId: null, seeded: true }),
    resetDemo: async () => ({ userId: "u", clerkId: null, seeded: true }),
    createPlan: graphService.createPlan,
    getPlanById: async () => rev2View(),
    getCurrentPlan: async () => rev2View(),
    transferBalance: async () => ({
      planLineageId: "lineage-1",
      staledPlanId: "plan-1",
      replanJobId: "job-1",
      currentPlan: rev2View(),
      idempotencyReplayed: false,
    }),
  };

  it("returns revision 2 graph result for the canonical transfer", async () => {
    const app = createComparisonRoutes(deps({ replanService }));
    const response = await app.request("/demo/simulate-transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletId: "transfer-required" }),
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      transfer: { amountPoints: number };
      currentPlan: { revisionNumber: number };
      graphResult: { variant: string; status: string };
      idempotencyReplayed: boolean;
    };
    expect(json.transfer.amountPoints).toBe(15000);
    expect(json.currentPlan.revisionNumber).toBe(2);
    expect(json.graphResult.variant).toBe("live-graph-orchestrator");
    expect(json.graphResult.status).toBe("succeeded");
    expect(json.idempotencyReplayed).toBe(false);
  });

  it("surfaces idempotent replay without a new replan job", async () => {
    const replayService: PlanService = {
      ...replanService,
      transferBalance: async () => ({
        planLineageId: "lineage-1",
        staledPlanId: "plan-1",
        replanJobId: null,
        currentPlan: rev2View(),
        idempotencyReplayed: true,
      }),
    };
    const app = createComparisonRoutes(deps({ replanService: replayService }));
    const response = await app.request("/demo/simulate-transfer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        walletId: "transfer-required",
        idempotencyKey: "same-key",
      }),
    });
    expect(response.status).toBe(200);
    const json = (await response.json()) as { idempotencyReplayed: boolean; replanJobId: null };
    expect(json.idempotencyReplayed).toBe(true);
    expect(json.replanJobId).toBeNull();
  });

  it("resets the canonical persona's balances before each run when a pool is provided", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    const response = await postComparison(deps({ pool }), { walletId: "transfer-required" });
    expect(response.status).toBe(200);

    // One UPDATE per canonical balance (Chase / Hyatt / United), scoped to a001.
    const updates = query.mock.calls.filter((c) => String(c[0]).includes("UPDATE user_balances"));
    expect(updates).toHaveLength(3);
    const hyatt = updates.find((c) => c[1]?.[2] === "00000000-0000-0000-0000-00000000b002");
    expect(hyatt?.[1]?.[0]).toBe(30000); // Hyatt restored to the transfer-required 30k
    expect(hyatt?.[1]?.[1]).toBe("00000000-0000-0000-0000-00000000a001");
  });

  it("runs without a pool (no reset) and still returns three results", async () => {
    const response = await postComparison(deps(), { walletId: "transfer-required" });
    expect(response.status).toBe(200);
    const json = (await response.json()) as ArchitectureComparisonResponse;
    expect(json.results).toHaveLength(3);
  });
});
