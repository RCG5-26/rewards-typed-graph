// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import BenchmarkPage from "./page";

afterEach(cleanup);

describe("/benchmark page", () => {
  it("renders both evidence sections, kept distinct", () => {
    render(<BenchmarkPage />);

    // Page identity.
    expect(screen.getByRole("heading", { name: /benchmark & evidence/i })).toBeInTheDocument();

    // Section 1: the 30-case fixture-backed benchmark (artifact-driven view).
    expect(screen.getByRole("heading", { name: /30-case architecture benchmark/i })).toBeInTheDocument();
    expect(screen.getByText(/fixture-backed quantitative evaluation/i)).toBeInTheDocument();
    expect(screen.getByText(/gold suite/i)).toBeInTheDocument();

    // Section 2: live structural hero evidence — explicitly NOT 30-case accuracy.
    expect(
      screen.getByRole("heading", { name: /live orchestrator hero-scenario evidence/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/structural hero-scenario evidence/i)).toBeInTheDocument();
    // The distinction line text node ends with "...30-case accuracy. Run it live...".
    expect(screen.getByText(/30-case accuracy\./i)).toBeInTheDocument();
  });

  it("links back to the live comparison", () => {
    render(<BenchmarkPage />);
    const backLinks = screen.getAllByRole("link", { name: /back to live comparison/i });
    expect(backLinks.length).toBeGreaterThan(0);
    expect(backLinks[0].getAttribute("href")).toBe("/test-wallets");
  });
});
