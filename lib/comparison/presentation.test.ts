import { describe, expect, it } from "vitest";

import {
  actionLabel,
  centsPerPoint,
  evaluationChecks,
  formatLatency,
  formatPoints,
  programName,
  routeRatioLabel,
} from "./presentation";
import type { PlanEvaluation, PublicWalletFacts } from "./types";

describe("comparison presentation helpers", () => {
  it("formats points and latency for display", () => {
    expect(formatPoints(180000)).toBe("180,000");
    expect(formatPoints(undefined)).toBe("—");
    expect(formatLatency(450)).toBe("450 ms");
    expect(formatLatency(10400)).toBe("10.4 s");
  });

  it("labels actions and derives value/ratio strings", () => {
    expect(actionLabel("transfer")).toBe("Transfer");
    expect(actionLabel("redeem")).toBe("Redeem");
    expect(centsPerPoint(23333)).toBe("2.33¢/pt");
    expect(routeRatioLabel(10000)).toBe("1:1");
  });

  it("resolves a program name from facts", () => {
    const facts = {
      programs: [{ programId: "p1", programSlug: "program:chase_ur", name: "Chase", issuer: "Chase" }],
    } as unknown as PublicWalletFacts;
    expect(programName(facts, "p1")).toBe("Chase");
    expect(programName(facts, undefined)).toBe("—");
  });

  it("surfaces correctness and grounding as separate evaluation rows", () => {
    const evaluation: PlanEvaluation = {
      structurallyValid: true,
      goalSatisfied: true,
      affordable: true,
      supportedTransferRoute: true,
      allAwardReferencesGrounded: false,
      negativeBalanceCreated: false,
      unnecessaryTransfer: false,
      issues: [],
    };
    const checks = evaluationChecks(evaluation);
    expect(checks.find((c) => c.label === "Goal satisfied")?.ok).toBe(true);
    expect(checks.find((c) => c.label === "Grounded")?.ok).toBe(false);
  });
});
