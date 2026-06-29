// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { WalletFactsPanel } from "./WalletFactsPanel";
import type { PublicWalletFacts } from "@/lib/comparison/types";

afterEach(cleanup);

const FACTS: PublicWalletFacts = {
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

describe("WalletFactsPanel", () => {
  it("renders the header (display name + description)", () => {
    render(<WalletFactsPanel facts={FACTS} />);
    expect(screen.getByText("Transfer Required")).toBeInTheDocument();
    expect(screen.getByText("Hyatt cannot fund Ginza directly.")).toBeInTheDocument();
  });

  it("renders program balances with formatted points", () => {
    render(<WalletFactsPanel facts={FACTS} />);
    expect(screen.getByText("Program balances")).toBeInTheDocument();
    expect(screen.getByText("180,000")).toBeInTheDocument();
    expect(screen.getByText("30,000")).toBeInTheDocument();
  });

  it("renders transfer routes with the 1:1 ratio label", () => {
    render(<WalletFactsPanel facts={FACTS} />);
    expect(screen.getByText("Transfer routes")).toBeInTheDocument();
    // Route text is split across nodes; match the parent <li>.
    expect(screen.getByText(/Chase Ultimate Rewards →/)).toHaveTextContent(
      "Chase Ultimate Rewards → World of Hyatt (1:1)",
    );
  });

  it("renders cards and award options", () => {
    render(<WalletFactsPanel facts={FACTS} />);
    expect(screen.getByText("Cards")).toBeInTheDocument();
    expect(screen.getByText(/Chase Sapphire Reserve/)).toBeInTheDocument();
    expect(screen.getByText("Award options")).toBeInTheDocument();
    expect(screen.getByText("Ginza")).toBeInTheDocument();
    expect(screen.getByText(/45,000/)).toBeInTheDocument();
  });

  it("renders the Goal and verbatim Query block", () => {
    render(<WalletFactsPanel facts={FACTS} />);
    expect(screen.getByText("Goal")).toBeInTheDocument();
    expect(screen.getByText(/3-night hotel award in Tokyo/)).toBeInTheDocument();
    expect(screen.getByText(/Query \(sent verbatim/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(FACTS.query.slice(0, 30)))).toBeInTheDocument();
  });
});
