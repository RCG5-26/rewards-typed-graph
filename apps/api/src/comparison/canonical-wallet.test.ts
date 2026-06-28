import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  CANONICAL_QUERY,
  TRANSFER_REQUIRED_WALLET,
  getCanonicalWallet,
  isApprovedWalletId,
  knownAwardIdentifiers,
} from "./canonical-wallet";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${REPO_ROOT}${relativePath}`, "utf8"));
}

describe("canonical wallet", () => {
  it("resolves the approved transfer-required wallet and rejects others", () => {
    expect(isApprovedWalletId("transfer-required")).toBe(true);
    expect(isApprovedWalletId("direct-redemption")).toBe(false);
    expect(getCanonicalWallet("transfer-required")).toBe(TRANSFER_REQUIRED_WALLET);
    expect(getCanonicalWallet("nope")).toBeUndefined();
  });

  it("contains no private gold (no expected winner / score / correct-answer labels)", () => {
    const serialized = JSON.stringify(TRANSFER_REQUIRED_WALLET).toLowerCase();
    for (const banned of ["expected", "winner", "gold", "score", "correct"]) {
      expect(serialized).not.toContain(banned);
    }
  });

  it("matches the live graph source of truth (fixtures/demo-seed.json)", () => {
    const seed = readJson("fixtures/demo-seed.json");
    const balances = seed.user_balances as Array<{ program_id: string; balance_points: number }>;
    const byProgram = new Map(balances.map((b) => [b.program_id, b.balance_points]));
    for (const balance of TRANSFER_REQUIRED_WALLET.balances) {
      expect(byProgram.get(balance.programId)).toBe(balance.points);
    }
    const options = seed.redemption_options as Array<{ id: string; min_points: number }>;
    const byAward = new Map(options.map((o) => [o.id, o.min_points]));
    for (const award of TRANSFER_REQUIRED_WALLET.awardOptions) {
      expect(byAward.get(award.awardId)).toBe(award.pointsRequired);
    }
  });

  it("matches the baseline prompt fixture (fixtures/demo-comparison-baseline.json)", () => {
    const fixture = readJson("fixtures/demo-comparison-baseline.json");
    const balances = fixture.balances as Array<{ program_slug: string; balance_points: number }>;
    const bySlug = new Map(balances.map((b) => [b.program_slug, b.balance_points]));
    for (const balance of TRANSFER_REQUIRED_WALLET.balances) {
      expect(bySlug.get(balance.programSlug)).toBe(balance.points);
    }
    const awards = fixture.award_options as Array<{ slug: string; points_total: number }>;
    const byAwardSlug = new Map(awards.map((a) => [a.slug, a.points_total]));
    for (const award of TRANSFER_REQUIRED_WALLET.awardOptions) {
      expect(byAwardSlug.get(award.awardSlug)).toBe(award.pointsRequired);
    }
  });

  it("keeps the canonical query verbatim across the wallet and the baseline cases file", () => {
    const cases = readJson("benchmark/gold/demo-comparison-cases.json");
    const caseList = cases.cases as Array<{ query: string; starting_balance_points: number }>;
    expect(TRANSFER_REQUIRED_WALLET.query).toBe(CANONICAL_QUERY);
    expect(caseList[0].query).toBe(CANONICAL_QUERY);
    // Chase 180k is the balance the baseline overrides to from starting_balance_points.
    expect(caseList[0].starting_balance_points).toBe(180000);
  });

  it("proves the transfer-required invariant from public facts alone (Hyatt 30k < Ginza 45k)", () => {
    const hyatt = TRANSFER_REQUIRED_WALLET.balances.find((b) => b.programSlug === "program:hyatt");
    const ginza = TRANSFER_REQUIRED_WALLET.awardOptions.find(
      (a) => a.awardSlug === "award:demo_hyatt_ginza:tokyo:3n",
    );
    expect(hyatt?.points).toBe(30000);
    expect(ginza?.pointsRequired).toBe(45000);
    expect((hyatt?.points ?? 0) < (ginza?.pointsRequired ?? 0)).toBe(true);
    // Shortfall closed by a 1:1 Chase->Hyatt transfer of 15,000.
    expect((ginza?.pointsRequired ?? 0) - (hyatt?.points ?? 0)).toBe(15000);
  });

  it("exposes both UUID and slug grounding identifiers for each award", () => {
    const ids = knownAwardIdentifiers(TRANSFER_REQUIRED_WALLET);
    expect(ids.has("00000000-0000-0000-0000-00000000f001")).toBe(true);
    expect(ids.has("award:demo_hyatt_ginza:tokyo:3n")).toBe(true);
  });
});
