import { describe, expect, it } from "vitest";

import {
  ARCHITECTURE_VARIANTS,
  type ArchitectureComparisonResult,
  isValidComparisonResult,
  validateComparisonResult,
  validateNormalizedPlan,
} from "./types";

function validResult(): ArchitectureComparisonResult {
  return {
    variant: "live-graph-orchestrator",
    status: "succeeded",
    walletId: "transfer-required",
    walletVersion: "demo-seed-v1",
    query: "What is the best way to use my points for a three-night hotel stay in Tokyo?",
    plan: {
      summary: "Transfer 15,000 Chase to Hyatt, then redeem the Ginza award.",
      goalSatisfied: true,
      transferRequired: true,
      transferAmount: 15000,
      selectedProgramId: "b002",
      selectedAwardId: "f001",
      redemptionPoints: 45000,
      steps: [
        { order: 1, actionType: "transfer", title: "Transfer 15,000 Chase → Hyatt" },
        { order: 2, actionType: "redeem", title: "Redeem Ginza award" },
      ],
    },
    metrics: { latencyMs: 10400 },
  };
}

describe("comparison contract", () => {
  it("exposes exactly the three frozen variants", () => {
    expect(ARCHITECTURE_VARIANTS).toEqual([
      "live-graph-orchestrator",
      "chat-crew",
      "single-agent",
    ]);
  });

  it("accepts a well-formed succeeded result", () => {
    expect(validateComparisonResult(validResult())).toEqual([]);
    expect(isValidComparisonResult(validResult())).toBe(true);
  });

  it("requires a plan on a succeeded result", () => {
    const result = { ...validResult(), plan: undefined };
    expect(validateComparisonResult(result)).toContain("succeeded result must include a plan");
  });

  it("requires an error on a failed result", () => {
    const result: unknown = {
      ...validResult(),
      status: "failed",
      plan: undefined,
    };
    expect(validateComparisonResult(result)).toContain("failed result must include an error");
  });

  it("accepts a failed result that carries an error and no plan", () => {
    const result: ArchitectureComparisonResult = {
      variant: "chat-crew",
      status: "failed",
      walletId: "transfer-required",
      walletVersion: "demo-seed-v1",
      query: "q",
      metrics: { latencyMs: 0 },
      error: { category: "provider_error", message: "openai timeout" },
    };
    expect(validateComparisonResult(result)).toEqual([]);
  });

  it("keeps correctness and grounding independent (correct award, ungrounded provenance)", () => {
    const result = validResult();
    result.evaluation = {
      structurallyValid: true,
      goalSatisfied: true,
      affordable: true,
      supportedTransferRoute: true,
      allAwardReferencesGrounded: false,
      negativeBalanceCreated: false,
      unnecessaryTransfer: false,
      issues: [],
    };
    // The shape is representable and valid — the two fields disagree by design.
    expect(validateComparisonResult(result)).toEqual([]);
    expect(result.evaluation.goalSatisfied).toBe(true);
    expect(result.evaluation.allAwardReferencesGrounded).toBe(false);
  });

  it("rejects malformed variant and status", () => {
    const issues = validateComparisonResult({
      variant: "best-architecture",
      status: "winning",
      walletId: "transfer-required",
      walletVersion: "demo-seed-v1",
      query: "q",
      metrics: { latencyMs: 1 },
    });
    expect(issues).toContain("invalid variant");
    expect(issues).toContain("invalid status");
  });

  it("flags malformed plan steps", () => {
    const issues = validateNormalizedPlan({
      summary: "x",
      goalSatisfied: true,
      transferRequired: false,
      steps: [{ order: "first", actionType: "win", title: 5 }],
    });
    expect(issues).toContain("step[0].order must be a number");
    expect(issues).toContain("step[0].actionType invalid");
    expect(issues).toContain("step[0].title must be a string");
  });
});
