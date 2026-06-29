import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  APPROVED_WALLET_IDS,
  CANONICAL_QUERY,
  DIRECT_REDEMPTION_WALLET,
  NO_FEASIBLE_PATH_WALLET,
  TRANSFER_REQUIRED_WALLET,
  getBaselineFixturePaths,
  getCanonicalWallet,
  isApprovedWalletId,
  knownAwardIdentifiers,
} from "./canonical-wallet";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(`${REPO_ROOT}${relativePath}`, "utf8"));
}

describe("canonical wallet", () => {
  it("resolves all three approved wallets and rejects unknown ids", () => {
    expect(isApprovedWalletId("transfer-required")).toBe(true);
    expect(isApprovedWalletId("direct-redemption")).toBe(true);
    expect(isApprovedWalletId("no-feasible-path")).toBe(true);
    expect(isApprovedWalletId("nope")).toBe(false);
    expect(getCanonicalWallet("transfer-required")).toBe(TRANSFER_REQUIRED_WALLET);
    expect(getCanonicalWallet("direct-redemption")).toBe(DIRECT_REDEMPTION_WALLET);
    expect(getCanonicalWallet("no-feasible-path")).toBe(NO_FEASIBLE_PATH_WALLET);
    expect(getCanonicalWallet("nope")).toBeUndefined();
  });

  it("exposes exactly three selectable scenarios with distinct display names", () => {
    expect(APPROVED_WALLET_IDS).toHaveLength(3);
    const names = APPROVED_WALLET_IDS.map((id) => getCanonicalWallet(id)!.displayName);
    expect(new Set(names).size).toBe(3);
  });

  it("contains no private gold in any wallet's public facts", () => {
    for (const id of APPROVED_WALLET_IDS) {
      const serialized = JSON.stringify(getCanonicalWallet(id)).toLowerCase();
      for (const banned of ["expected", "winner", "gold", "score", "correct"]) {
        expect(serialized).not.toContain(banned);
      }
    }
  });

  it("lists all three programs (including zero balances) on every scenario", () => {
    for (const id of APPROVED_WALLET_IDS) {
      const facts = getCanonicalWallet(id)!;
      const slugs = facts.balances.map((b) => b.programSlug).sort();
      expect(slugs).toEqual(["program:chase_ur", "program:hyatt", "program:united"]);
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

  it("proves the direct-redemption invariant (Hyatt 60k ≥ Ginza 45k, no transfer)", () => {
    const hyatt = DIRECT_REDEMPTION_WALLET.balances.find((b) => b.programSlug === "program:hyatt");
    const ginza = DIRECT_REDEMPTION_WALLET.awardOptions.find(
      (a) => a.awardSlug === "award:demo_hyatt_ginza:tokyo:3n",
    );
    expect(hyatt?.points).toBe(60000);
    expect(ginza?.pointsRequired).toBe(45000);
    expect((hyatt?.points ?? 0) >= (ginza?.pointsRequired ?? 0)).toBe(true);
    // Chase is empty, so a correct planner must NOT route through a transfer.
    expect(DIRECT_REDEMPTION_WALLET.balances.find((b) => b.programSlug === "program:chase_ur")?.points).toBe(0);
  });

  it("proves the no-feasible-path invariant (no balance funds any award, Chase 0)", () => {
    const byProgram = new Map(
      NO_FEASIBLE_PATH_WALLET.balances.map((b) => [b.programSlug, b.points]),
    );
    const ginza = NO_FEASIBLE_PATH_WALLET.awardOptions.find(
      (a) => a.awardSlug === "award:demo_hyatt_ginza:tokyo:3n",
    );
    const united = NO_FEASIBLE_PATH_WALLET.awardOptions.find(
      (a) => a.awardSlug === "award:demo_united_tokyo:3n",
    );
    expect(byProgram.get("program:chase_ur")).toBe(0);
    expect((byProgram.get("program:hyatt") ?? 0) < (ginza?.pointsRequired ?? 0)).toBe(true);
    expect((byProgram.get("program:united") ?? 0) < (united?.pointsRequired ?? 0)).toBe(true);
    // The only routes are Chase->X; with Chase at 0 there is no fundable path.
    for (const route of NO_FEASIBLE_PATH_WALLET.transferRoutes) {
      expect(route.sourceProgramSlug).toBe("program:chase_ur");
    }
  });

  it("keeps each new scenario's baseline fixture and cases in sync with its facts", () => {
    const scenarios = [
      { wallet: DIRECT_REDEMPTION_WALLET, id: "direct-redemption" as const },
      { wallet: NO_FEASIBLE_PATH_WALLET, id: "no-feasible-path" as const },
    ];
    for (const { wallet, id } of scenarios) {
      const paths = getBaselineFixturePaths(id);
      const fixture = readJson(paths.fixturePath);
      const fixtureBalances = fixture.balances as Array<{
        program_slug: string;
        balance_points: number;
      }>;
      const bySlug = new Map(fixtureBalances.map((b) => [b.program_slug, b.balance_points]));
      for (const balance of wallet.balances) {
        expect(bySlug.get(balance.programSlug)).toBe(balance.points);
      }
      // The Python baseline overrides only the Chase balance from the case, so
      // starting_balance_points must equal this scenario's Chase balance.
      const cases = readJson(paths.casesPath);
      const caseList = cases.cases as Array<{ query: string; starting_balance_points: number }>;
      const chase = wallet.balances.find((b) => b.programSlug === "program:chase_ur");
      expect(caseList[0].starting_balance_points).toBe(chase?.points);
      expect(caseList[0].query).toBe(CANONICAL_QUERY);
    }
  });

  it("exposes both UUID and slug grounding identifiers for each award", () => {
    const ids = knownAwardIdentifiers(TRANSFER_REQUIRED_WALLET);
    expect(ids.has("00000000-0000-0000-0000-00000000f001")).toBe(true);
    expect(ids.has("award:demo_hyatt_ginza:tokyo:3n")).toBe(true);
  });
});
