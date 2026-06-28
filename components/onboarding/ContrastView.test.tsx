// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ContrastView from "./ContrastView";

afterEach(cleanup);
import { benchmarkReport, isMeasured } from "@/lib/benchmark/report";

describe("ContrastView", () => {
  it("renders one column per architecture in the report", () => {
    render(<ContrastView />);
    for (const a of benchmarkReport.architectures) {
      expect(screen.getByText(a.label)).toBeTruthy();
    }
  });

  it("shows real measured metrics for the typed-graph column", () => {
    render(<ContrastView />);
    const typed = benchmarkReport.architectures.find((a) => a.key === "typed_graph_fixture");
    expect(typed && isMeasured(typed)).toBe(true);
    if (typed && isMeasured(typed)) {
      expect(
        screen.getByText(new RegExp(`${typed.accuracyPassed}/${typed.accuracyTotal}`)),
      ).toBeTruthy();
    }
    expect(screen.getByText("measured")).toBeTruthy();
  });

  it("marks not-run baselines instead of fabricating numbers", () => {
    render(<ContrastView />);
    const notRun = benchmarkReport.architectures.filter((a) => a.status === "not_run");
    expect(notRun.length).toBeGreaterThan(0);
    expect(screen.getAllByText("not run").length).toBe(notRun.length);
    expect(screen.getAllByText(/needs a paid key/i).length).toBe(notRun.length);
  });
});
