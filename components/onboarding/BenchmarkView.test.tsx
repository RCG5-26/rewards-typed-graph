// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BenchmarkView from "./BenchmarkView";
import type { LiveMetrics } from "@/lib/plan/comparison";

const metrics: LiveMetrics = {
  planValueCents: 10000,
  opCount: 5,
  invalidationCaught: false,
  revision: 1,
};

describe("BenchmarkView", () => {
  it("renders the benchmark heading", () => {
    render(<BenchmarkView metrics={metrics} />);
    expect(screen.getByText(/benchmark/i)).toBeTruthy();
  });

  it("renders token cost row with live label", () => {
    render(<BenchmarkView metrics={metrics} />);
    expect(screen.getAllByText(/token cost/i).length).toBeGreaterThan(0);
  });

  it("shows live indicator when invalidation is caught", () => {
    render(<BenchmarkView metrics={{ ...metrics, invalidationCaught: true }} />);
    // hint changes to include 'live' when caught
    expect(screen.getByText(/higher is better · live/i)).toBeTruthy();
  });

  it("shows run-a-replan hint when invalidation not yet caught", () => {
    render(<BenchmarkView metrics={metrics} />);
    expect(screen.getAllByText(/run a replan/i).length).toBeGreaterThan(0);
  });
});
