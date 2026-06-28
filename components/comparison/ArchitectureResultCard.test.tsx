// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ArchitectureResultCard } from "./ArchitectureResultCard";
import type { ArchitectureComparisonResult, PublicWalletFacts } from "@/lib/comparison/types";

afterEach(cleanup);

const FACTS = {
  programs: [
    { programId: "p-chase", programSlug: "program:chase_ur", name: "Chase Ultimate Rewards", issuer: "Chase" },
    { programId: "p-hyatt", programSlug: "program:hyatt", name: "World of Hyatt", issuer: "Hyatt" },
  ],
} as unknown as PublicWalletFacts;

function succeededResult(): ArchitectureComparisonResult {
  return {
    variant: "live-graph-orchestrator",
    status: "succeeded",
    walletId: "transfer-required",
    walletVersion: "demo-seed-v1",
    query: "q",
    plan: {
      summary: "Transfer Chase to Hyatt, then redeem Ginza.",
      goalSatisfied: true,
      transferRequired: true,
      transferAmount: 15000,
      selectedAwardId: "award:demo_hyatt_ginza:tokyo:3n",
      steps: [
        {
          order: 1,
          actionType: "transfer",
          title: "Transfer 15,000 Chase to Hyatt",
          sourceProgramId: "p-chase",
          destinationProgramId: "p-hyatt",
          points: 15000,
        },
        { order: 2, actionType: "redeem", title: "Redeem the Ginza award" },
      ],
    },
    evaluation: {
      structurallyValid: true,
      goalSatisfied: true,
      affordable: true,
      supportedTransferRoute: true,
      allAwardReferencesGrounded: true,
      negativeBalanceCreated: false,
      unnecessaryTransfer: false,
      issues: [],
    },
    metrics: { latencyMs: 10400 },
    evidence: { agentTypes: ["wallet-specialist", "redemption-specialist"], planId: "plan-1" },
  };
}

describe("ArchitectureResultCard", () => {
  it("renders an idle prompt before a run", () => {
    render(<ArchitectureResultCard variant="chat-crew" facts={FACTS} state={{ phase: "idle" }} />);
    expect(screen.getByText(/Run the comparison/i)).toBeTruthy();
    expect(screen.getByText("Chat Crew")).toBeTruthy();
  });

  it("renders a loading skeleton while running", () => {
    render(<ArchitectureResultCard variant="single-agent" facts={FACTS} state={{ phase: "loading" }} />);
    expect(screen.getByLabelText("loading")).toBeTruthy();
    expect(screen.getByText(/Running/i)).toBeTruthy();
  });

  it("renders a succeeded plan with steps, evaluation, and metrics", () => {
    render(
      <ArchitectureResultCard
        variant="live-graph-orchestrator"
        facts={FACTS}
        state={{ phase: "result", result: succeededResult() }}
      />,
    );
    expect(screen.getByText("Succeeded")).toBeTruthy();
    expect(screen.getByText(/Transfer Chase to Hyatt/i)).toBeTruthy();
    expect(screen.getByText("Goal satisfied")).toBeTruthy();
    expect(screen.getByText("Grounded")).toBeTruthy();
    expect(screen.getByText(/10.4 s/)).toBeTruthy();
  });

  it("renders a failure card with the error message, isolated from others", () => {
    const failed: ArchitectureComparisonResult = {
      variant: "chat-crew",
      status: "failed",
      walletId: "transfer-required",
      walletVersion: "demo-seed-v1",
      query: "q",
      metrics: { latencyMs: 120 },
      error: { category: "baseline_execution_error", message: "OPENAI_API_KEY missing" },
    };
    render(
      <ArchitectureResultCard variant="chat-crew" facts={FACTS} state={{ phase: "result", result: failed }} />,
    );
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText(/OPENAI_API_KEY missing/i)).toBeTruthy();
  });
});
