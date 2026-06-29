// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { TestWalletComparison } from "./TestWalletComparison";
import type {
  ArchitectureComparisonResponse,
  PublicWalletFacts,
} from "@/lib/comparison/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const WALLET: PublicWalletFacts = {
  walletId: "transfer-required",
  version: "demo-seed-v1",
  displayName: "Transfer Required",
  description: "Hyatt cannot fund Ginza directly.",
  programs: [
    { programId: "p-chase", programSlug: "program:chase_ur", name: "Chase Ultimate Rewards", issuer: "Chase" },
    { programId: "p-hyatt", programSlug: "program:hyatt", name: "World of Hyatt", issuer: "Hyatt" },
  ],
  cards: [
    { cardId: "c1", cardName: "Chase Sapphire Reserve", issuer: "Chase", programId: "p-chase", programName: "Chase Ultimate Rewards" },
  ],
  balances: [
    { programId: "p-chase", programSlug: "program:chase_ur", programName: "Chase Ultimate Rewards", points: 180000, version: 1 },
    { programId: "p-hyatt", programSlug: "program:hyatt", programName: "World of Hyatt", points: 30000, version: 1 },
  ],
  transferRoutes: [
    { sourceProgramId: "p-chase", sourceProgramSlug: "program:chase_ur", destinationProgramId: "p-hyatt", destinationProgramSlug: "program:hyatt", ratioBasisPoints: 10000 },
  ],
  awardOptions: [
    { awardId: "a1", awardSlug: "award:demo_hyatt_ginza:tokyo:3n", displayName: "Ginza", programId: "p-hyatt", programSlug: "program:hyatt", pointsRequired: 45000, valueBasisPoints: 23333, available: true },
  ],
  goal: { destination: "Tokyo", category: "hotel_award", nights: 3 },
  query: "What is the best way to use my points for a three-night hotel stay in Tokyo?",
};

function response(): ArchitectureComparisonResponse {
  return {
    walletId: "transfer-required",
    walletVersion: "demo-seed-v1",
    query: WALLET.query,
    results: [
      {
        variant: "live-graph-orchestrator",
        status: "succeeded",
        walletId: "transfer-required",
        walletVersion: "demo-seed-v1",
        query: WALLET.query,
        plan: { summary: "Graph plan.", goalSatisfied: true, transferRequired: true, transferAmount: 15000, steps: [] },
        metrics: { latencyMs: 10400 },
        evidence: { lineageId: "lineage-1", planId: "plan-1", revisionNumber: 1 },
      },
      {
        variant: "chat-crew",
        status: "failed",
        walletId: "transfer-required",
        walletVersion: "demo-seed-v1",
        query: WALLET.query,
        metrics: { latencyMs: 120 },
        error: { category: "baseline_execution_error", message: "OPENAI_API_KEY missing" },
      },
      {
        variant: "single-agent",
        status: "succeeded",
        walletId: "transfer-required",
        walletVersion: "demo-seed-v1",
        query: WALLET.query,
        plan: { summary: "Single plan.", goalSatisfied: true, transferRequired: true, transferAmount: 15000, steps: [] },
        metrics: { latencyMs: 10900 },
      },
    ],
  };
}

describe("TestWalletComparison", () => {
  it("shows the canonical facts and verbatim query before a run", () => {
    render(<TestWalletComparison wallets={[WALLET]} />);
    expect(screen.getByText("180,000")).toBeTruthy();
    expect(screen.getByText(new RegExp(WALLET.query.slice(0, 30)))).toBeTruthy();
    // "Not started" appears in each architecture result card (3) + each lane in
    // the ArchitectureExecutionOverview (3) = 6 total.
    expect(screen.getAllByText(/Not started/i).length).toBe(6);
  });

  it("disables the replan button before a comparison has run", () => {
    render(<TestWalletComparison wallets={[WALLET]} />);
    const replan = screen.getByText(/Complete 15,000-point transfer/i) as HTMLButtonElement;
    expect(replan.disabled).toBe(true);
  });

  it("simulates the canonical transfer and updates the graph card", async () => {
    const comparison = response();
    const simulate = {
      walletId: "transfer-required",
      walletVersion: "demo-seed-v1",
      idempotencyReplayed: false,
      transfer: {
        sourceProgramId: "p-chase",
        destProgramId: "p-hyatt",
        amountPoints: 15000,
      },
      replanJobId: "job-1",
      staledPlanId: "plan-1",
      currentPlan: {
        planId: "plan-2",
        planLineageId: "lineage-1",
        revisionNumber: 2,
        status: "current",
        query: WALLET.query,
        summary: "Redeem Ginza.",
        steps: [{ order: 1, type: "redemption_recommendation", summary: "Redeem Ginza", status: "current" }],
      },
      graphResult: {
        ...comparison.results[0],
        plan: {
          summary: "Redeem Ginza after transfer.",
          goalSatisfied: true,
          transferRequired: false,
          steps: [],
        },
        evidence: { ...comparison.results[0].evidence, revisionNumber: 2 },
      },
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => comparison })
      .mockResolvedValueOnce({ ok: true, json: async () => simulate });
    vi.stubGlobal("fetch", fetchMock);

    render(<TestWalletComparison wallets={[WALLET]} />);
    fireEvent.click(screen.getByText("Run comparison"));
    await waitFor(() => expect(screen.getAllByText("Completed").length).toBeGreaterThanOrEqual(2));

    const replan = screen.getByText(/Complete 15,000-point transfer/i) as HTMLButtonElement;
    expect(replan.disabled).toBe(false);
    fireEvent.click(replan);

    await waitFor(() =>
      expect(screen.getByText(/Revision 2 is now current/i)).toBeTruthy(),
    );
    expect(screen.getByText("165,000")).toBeTruthy();
    expect(screen.getByText("45,000")).toBeTruthy();
  });

  it("shows the idempotent-replay success panel (aria-live, balances unchanged)", async () => {
    const comparison = response();
    const simulate = {
      walletId: "transfer-required",
      walletVersion: "demo-seed-v1",
      idempotencyReplayed: true,
      transfer: { sourceProgramId: "p-chase", destProgramId: "p-hyatt", amountPoints: 15000 },
      replanJobId: null,
      staledPlanId: null,
      currentPlan: {
        planId: "plan-2",
        planLineageId: "lineage-1",
        revisionNumber: 2,
        status: "current",
        query: WALLET.query,
        summary: "Redeem Ginza.",
        steps: [{ order: 1, type: "redemption_recommendation", summary: "Redeem Ginza", status: "current" }],
      },
      graphResult: { ...comparison.results[0], evidence: { ...comparison.results[0].evidence, revisionNumber: 2 } },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => comparison })
      .mockResolvedValueOnce({ ok: true, json: async () => simulate });
    vi.stubGlobal("fetch", fetchMock);

    render(<TestWalletComparison wallets={[WALLET]} />);
    fireEvent.click(screen.getByText("Run comparison"));
    await waitFor(() => expect(screen.getAllByText("Completed").length).toBeGreaterThanOrEqual(2));
    fireEvent.click(screen.getByText(/Complete 15,000-point transfer/i));

    await waitFor(() =>
      expect(screen.getByText(/Transfer already applied — Plan unchanged/i)).toBeTruthy(),
    );
    // The status surface is an aria-live region for assistive tech.
    const live = screen.getByText(/Idempotent replay — balances and Plan revision unchanged/i).closest("[aria-live]");
    expect(live).not.toBeNull();
    expect(live?.getAttribute("aria-live")).toBe("polite");
    // A replay leaves balances untouched (no 165,000 deduction).
    expect(screen.getByText("180,000")).toBeTruthy();
    expect(screen.queryByText("165,000")).toBeNull();
  });

  it("runs the comparison and renders three independent results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => response(),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TestWalletComparison wallets={[WALLET]} />);
    fireEvent.click(screen.getByText("Run comparison"));

    await waitFor(() => expect(screen.getAllByText("Failed").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Completed").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/OPENAI_API_KEY missing/i)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/demo/architecture-comparison",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces a network error without crashing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({ error: "Could not run the comparison." }) }));
    render(<TestWalletComparison wallets={[WALLET]} />);
    fireEvent.click(screen.getByText("Run comparison"));
    await waitFor(() => expect(screen.getAllByText(/Could not run the comparison/i).length).toBeGreaterThan(0));
  });
});
