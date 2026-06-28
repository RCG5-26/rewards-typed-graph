// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import BenchmarkView from "./BenchmarkView";

afterEach(cleanup);
import { benchmarkReport, isMeasured, pct } from "@/lib/benchmark/report";

describe("BenchmarkView", () => {
  it("renders the benchmark heading with the real case count", () => {
    render(<BenchmarkView />);
    expect(screen.getByText(new RegExp(`${benchmarkReport.caseCount}-case`, "i"))).toBeTruthy();
  });

  it("renders the three suite metric rows", () => {
    render(<BenchmarkView />);
    expect(screen.getByText("Plan accuracy")).toBeTruthy();
    expect(screen.getByText("Hallucinated ratios")).toBeTruthy();
    expect(screen.getByText("Invalidations caught")).toBeTruthy();
  });

  it("shows the real typed-graph accuracy from the captured report", () => {
    render(<BenchmarkView />);
    const typed = benchmarkReport.architectures.find((a) => a.key === "typed_graph_fixture");
    if (typed && isMeasured(typed)) {
      expect(
        screen.getByText(new RegExp(`${pct(typed.accuracyRate)} \\(${typed.accuracyPassed}/${typed.accuracyTotal}\\)`)),
      ).toBeTruthy();
    }
  });

  it("renders 'not run' for unscored baselines (one per metric row)", () => {
    render(<BenchmarkView />);
    const notRun = benchmarkReport.architectures.filter((a) => a.status === "not_run").length;
    // 3 metric rows × not-run architectures.
    expect(screen.getAllByText("not run").length).toBe(notRun * 3);
  });
});
