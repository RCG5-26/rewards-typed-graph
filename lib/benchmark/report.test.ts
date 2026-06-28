import { describe, expect, it } from "vitest";

import { benchmarkReport, isMeasured, pct } from "./report";

describe("benchmark report", () => {
  it("exposes the captured report metadata", () => {
    expect(benchmarkReport.benchmarkId).toBeTruthy();
    expect(benchmarkReport.caseCount).toBeGreaterThan(0);
    expect(benchmarkReport.architectures.length).toBeGreaterThanOrEqual(3);
  });

  it("scores the typed-graph architecture (measured, not fabricated)", () => {
    const typed = benchmarkReport.architectures.find((a) => a.key === "typed_graph_fixture");
    expect(typed).toBeDefined();
    expect(typed && isMeasured(typed)).toBe(true);
    if (typed && isMeasured(typed)) {
      expect(typed.accuracyRate).toBeGreaterThanOrEqual(0);
      expect(typed.accuracyRate).toBeLessThanOrEqual(1);
      expect(typed.accuracyTotal).toBe(benchmarkReport.caseCount);
    }
  });

  it("marks unscored architectures not_run with a runnable command", () => {
    for (const a of benchmarkReport.architectures) {
      if (a.status === "not_run") {
        expect(a.run).toMatch(/python/);
      }
    }
  });

  it("pct formats a 0..1 rate as a whole percent", () => {
    expect(pct(1)).toBe("100%");
    expect(pct(0)).toBe("0%");
    expect(pct(0.5)).toBe("50%");
  });
});
