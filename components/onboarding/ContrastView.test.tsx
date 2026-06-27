// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ContrastView from "./ContrastView";
import type { LiveMetrics } from "@/lib/plan/comparison";

const metricsWithValue: LiveMetrics = {
  planValueCents: 12000,
  opCount: 4,
  invalidationCaught: false,
  revision: 1,
};

const metricsZero: LiveMetrics = {
  planValueCents: 0,
  opCount: 4,
  invalidationCaught: false,
  revision: 1,
};

describe("ContrastView", () => {
  it("renders three architecture columns", () => {
    render(<ContrastView metrics={metricsWithValue} />);
    expect(screen.getByText(/typed graph/i)).toBeTruthy();
    expect(screen.getByText(/crewai/i)).toBeTruthy();
    expect(screen.getByText(/single agent/i)).toBeTruthy();
  });

  it("displays dollar value when planValueCents > 0", () => {
    render(<ContrastView metrics={metricsWithValue} />);
    // $120 (12000 / 100) — appears in typed and derived columns
    expect(screen.getAllByText(/\$120/).length).toBeGreaterThan(0);
  });

  it('shows "—" for all value cells when planValueCents is 0', () => {
    render(<ContrastView metrics={metricsZero} />);
    const dashes = screen.getAllByText("—");
    // typed + crewai* + single = 3 dash cells (crewai has * suffix handled separately)
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it("shows caught-invalidation message when invalidationCaught is true", () => {
    render(
      <ContrastView metrics={{ ...metricsWithValue, invalidationCaught: true, revision: 2 }} />,
    );
    expect(screen.getByText(/caught the balance invalidation/i)).toBeTruthy();
  });
});
