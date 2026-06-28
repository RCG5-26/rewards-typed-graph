import { describe, expect, it } from "vitest";

import { TRANSFER_REQUIRED_WALLET } from "../canonical-wallet";
import { evaluatePlan, isHardValid } from "../evaluator";
import type { PlanView } from "../../plans/types";
import { type GraphPlanRunner, runGraphOrchestrator } from "./graph-orchestrator";
import { normalizeGraphPlan } from "./graph-normalizer";

const FACTS = TRANSFER_REQUIRED_WALLET;
const CHASE = "00000000-0000-0000-0000-00000000b001";
const HYATT = "00000000-0000-0000-0000-00000000b002";
const GINZA_SLUG = "award:demo_hyatt_ginza:tokyo:3n";

function transferThenRedeemView(): PlanView {
  return {
    planId: "plan-1",
    planLineageId: "lineage-1",
    revisionNumber: 1,
    status: "current",
    query: FACTS.query,
    summary: "Transfer Chase to Hyatt, then redeem the Ginza award.",
    steps: [
      {
        order: 1,
        type: "redemption_recommendation",
        summary: "Redeem the Ginza award",
        reasoning: "Best value at 2.33 cpp.",
        status: "current",
        dependsOn: [],
        dependencies: [
          { id: "d1", kind: "award", table: "awards", slug: GINZA_SLUG, label: "Ginza", programId: HYATT },
        ],
      },
    ],
    graph: {
      nodes: [
        { id: "n-chase", kind: "program", slug: "program:chase_ur", label: "Chase Ultimate Rewards", programId: CHASE },
        { id: "n-hyatt", kind: "program", slug: "program:hyatt", label: "World of Hyatt", programId: HYATT },
        { id: "n-award", kind: "redemption", slug: GINZA_SLUG, label: "Ginza", programId: HYATT },
      ],
      edges: [
        { id: "e1", from: "n-chase", to: "n-hyatt", kind: "transfer" },
        { id: "e2", from: "n-hyatt", to: "n-award", kind: "redeem" },
      ],
    },
  };
}

describe("graph normalizer", () => {
  it("reads the selected award, redeeming program, and transfer route from the graph", () => {
    const plan = normalizeGraphPlan(transferThenRedeemView(), FACTS);
    expect(plan.selectedAwardId).toBe(GINZA_SLUG);
    expect(plan.selectedProgramId).toBe(HYATT);
    expect(plan.transferRequired).toBe(true);
  });

  it("synthesizes a transfer step from the edge and fills the implied 15,000 deficit", () => {
    const plan = normalizeGraphPlan(transferThenRedeemView(), FACTS);
    const transferStep = plan.steps.find((s) => s.actionType === "transfer");
    expect(transferStep?.sourceProgramId).toBe(CHASE);
    expect(transferStep?.destinationProgramId).toBe(HYATT);
    expect(transferStep?.points).toBe(15000); // 45,000 Ginza − 30,000 Hyatt
    expect(plan.transferAmount).toBe(15000);
  });

  it("produces a hard-valid, goal-satisfying plan under the deterministic evaluator", () => {
    const evaluation = evaluatePlan(normalizeGraphPlan(transferThenRedeemView(), FACTS), FACTS);
    expect(isHardValid(evaluation)).toBe(true);
    expect(evaluation.goalSatisfied).toBe(true);
    expect(evaluation.supportedTransferRoute).toBe(true);
  });
});

describe("graph adapter", () => {
  const fakeService = (view: PlanView): GraphPlanRunner => ({
    createPlan: async () => view,
  });

  it("returns a succeeded normalized result with graph evidence", async () => {
    const view = transferThenRedeemView();
    const result = await runGraphOrchestrator({ facts: FACTS, service: fakeService(view) });
    expect(result.variant).toBe("live-graph-orchestrator");
    expect(result.status).toBe("succeeded");
    expect(result.walletId).toBe("transfer-required");
    expect(result.query).toBe(FACTS.query);
    expect(result.evidence?.planId).toBe("plan-1");
    expect(result.evidence?.lineageId).toBe("lineage-1");
    expect(result.evidence?.citedAwardIds).toContain(GINZA_SLUG);
    expect(result.metrics.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns a failed result (not a throw) when the service errors", async () => {
    const service: GraphPlanRunner = {
      createPlan: async () => {
        throw new Error("db down");
      },
    };
    const result = await runGraphOrchestrator({ facts: FACTS, service });
    expect(result.status).toBe("failed");
    expect(result.error?.category).toBe("graph_execution_error");
    expect(result.error?.message).toContain("db down");
    expect(result.plan).toBeUndefined();
  });

  it("returns a bounded timeout failure when the service hangs (Fix 4)", async () => {
    // A service that never resolves — the adapter must still return, bounded.
    const service: GraphPlanRunner = {
      createPlan: () => new Promise<PlanView>(() => {}),
    };
    const result = await runGraphOrchestrator({ facts: FACTS, service, timeoutMs: 50 });
    expect(result.status).toBe("failed");
    expect(result.error?.category).toBe("graph_timeout");
    expect(result.error?.message).toMatch(/timed out after 50ms/);
    expect(result.plan).toBeUndefined();
  });
});
