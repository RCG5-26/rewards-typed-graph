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
    expect(screen.getAllByText(/Not started/i).length).toBe(3);
  });

  it("gates the replan button until Person A verifies (disabled, no claim it works)", () => {
    render(<TestWalletComparison wallets={[WALLET]} />);
    const replan = screen.getByText(/Simulate completed transfer/i) as HTMLButtonElement;
    expect(replan.disabled).toBe(true);
  });

  it("runs the comparison and renders three independent results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => response(),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TestWalletComparison wallets={[WALLET]} />);
    fireEvent.click(screen.getByText("Run comparison"));

    await waitFor(() => expect(screen.getByText("Failed")).toBeTruthy());
    expect(screen.getAllByText("Succeeded").length).toBe(2);
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
    await waitFor(() => expect(screen.getByText(/Could not run the comparison/i)).toBeTruthy());
  });
});
