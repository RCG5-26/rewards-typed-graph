/**
 * The single canonical-wallet source for the three-architecture comparison
 * (freeze §2/§3, demo sprint Step 2).
 *
 * This file holds ONLY public facts — the facts genuinely supplied to every
 * architecture: cards, balances, transfer routes, award options, the goal, and
 * the canonical query. It deliberately contains NO private gold: no expected
 * winning architecture, no expected score, no "correct answer" label. Those
 * live solely on the evaluator/gold side (the benchmark cases file's
 * `expected_top_award_slug`), never in anything handed to an agent.
 *
 * One source, three consumers:
 *  - the graph orchestrator reads the same numbers from live PostgreSQL
 *    (`fixtures/demo-seed.json`, persona a001) — kept in sync by a consistency
 *    test (`canonical-wallet.test.ts`);
 *  - the two LLM baselines read `fixtures/demo-comparison-baseline.json`
 *    (same numbers, person-c prompt schema) — kept in sync by the same test;
 *  - the evaluator and UI consume this object directly.
 *
 * Each program/award exposes BOTH its UUID (graph identifier) and its slug
 * (baseline identifier) so grounding works regardless of which id form an
 * architecture emits.
 */

export const CANONICAL_QUERY =
  "What is the best way to use my points for a three-night hotel stay in Tokyo?";

/** Approved wallet ids the comparison endpoint will accept (vertical slice = transfer-required). */
export const APPROVED_WALLET_IDS = ["transfer-required"] as const;
export type ApprovedWalletId = (typeof APPROVED_WALLET_IDS)[number];

/** Live-DB persona that the graph orchestrator plans for (demo-seed-v1). */
export const CANONICAL_GRAPH_USER_ID = "00000000-0000-0000-0000-00000000a001";

/** Paths (relative to repo root) the baseline subprocess adapters point Python at. */
export const CANONICAL_BASELINE_FIXTURE_PATH = "fixtures/demo-comparison-baseline.json";
export const CANONICAL_BASELINE_CASES_PATH = "benchmark/gold/demo-comparison-cases.json";

export interface CanonicalProgram {
  programId: string;
  programSlug: string;
  name: string;
  issuer: string;
}

export interface CanonicalCard {
  cardId: string;
  cardName: string;
  issuer: string;
  programId: string;
  programName: string;
}

export interface CanonicalBalance {
  programId: string;
  programSlug: string;
  programName: string;
  points: number;
  version: number;
}

export interface CanonicalTransferRoute {
  sourceProgramId: string;
  sourceProgramSlug: string;
  destinationProgramId: string;
  destinationProgramSlug: string;
  /** 10000 basis points = 1:1. */
  ratioBasisPoints: number;
}

export interface CanonicalAwardOption {
  awardId: string;
  awardSlug: string;
  displayName: string;
  programId: string;
  programSlug: string;
  pointsRequired: number;
  /** Redemption value in basis points (cents-per-point ×100); higher is better value. */
  valueBasisPoints: number;
  available: boolean;
}

export interface CanonicalGoal {
  destination: string;
  category: "hotel_award";
  nights: number;
}

export interface CanonicalWalletFacts {
  walletId: ApprovedWalletId;
  version: string;
  displayName: string;
  description: string;
  programs: CanonicalProgram[];
  cards: CanonicalCard[];
  balances: CanonicalBalance[];
  transferRoutes: CanonicalTransferRoute[];
  awardOptions: CanonicalAwardOption[];
  goal: CanonicalGoal;
  query: string;
}

const CHASE: CanonicalProgram = {
  programId: "00000000-0000-0000-0000-00000000b001",
  programSlug: "program:chase_ur",
  name: "Chase Ultimate Rewards",
  issuer: "Chase",
};
const HYATT: CanonicalProgram = {
  programId: "00000000-0000-0000-0000-00000000b002",
  programSlug: "program:hyatt",
  name: "World of Hyatt",
  issuer: "Hyatt",
};
const UNITED: CanonicalProgram = {
  programId: "00000000-0000-0000-0000-00000000b003",
  programSlug: "program:united",
  name: "United MileagePlus",
  issuer: "United Airlines",
};

export const TRANSFER_REQUIRED_WALLET: CanonicalWalletFacts = {
  walletId: "transfer-required",
  version: "demo-seed-v1",
  displayName: "Hero Demo — Transfer Required (Tokyo Hyatt)",
  description:
    "Hyatt balance cannot fund the Ginza award directly; a 1:1 Chase→Hyatt transfer closes the gap.",
  programs: [CHASE, HYATT, UNITED],
  cards: [
    {
      cardId: "card:chase_sapphire_reserve",
      cardName: "Chase Sapphire Reserve",
      issuer: "Chase",
      programId: CHASE.programId,
      programName: CHASE.name,
    },
    {
      cardId: "card:chase_sapphire_preferred",
      cardName: "Chase Sapphire Preferred",
      issuer: "Chase",
      programId: CHASE.programId,
      programName: CHASE.name,
    },
    {
      cardId: "card:chase_freedom_unlimited",
      cardName: "Chase Freedom Unlimited",
      issuer: "Chase",
      programId: CHASE.programId,
      programName: CHASE.name,
    },
    {
      cardId: "card:world_of_hyatt",
      cardName: "World of Hyatt Credit Card",
      issuer: "Chase",
      programId: HYATT.programId,
      programName: HYATT.name,
    },
    {
      cardId: "card:united_explorer",
      cardName: "United Explorer Card",
      issuer: "Chase",
      programId: UNITED.programId,
      programName: UNITED.name,
    },
  ],
  balances: [
    { programId: CHASE.programId, programSlug: CHASE.programSlug, programName: CHASE.name, points: 180000, version: 1 },
    { programId: HYATT.programId, programSlug: HYATT.programSlug, programName: HYATT.name, points: 30000, version: 1 },
    { programId: UNITED.programId, programSlug: UNITED.programSlug, programName: UNITED.name, points: 30000, version: 1 },
  ],
  transferRoutes: [
    {
      sourceProgramId: CHASE.programId,
      sourceProgramSlug: CHASE.programSlug,
      destinationProgramId: HYATT.programId,
      destinationProgramSlug: HYATT.programSlug,
      ratioBasisPoints: 10000,
    },
    {
      sourceProgramId: CHASE.programId,
      sourceProgramSlug: CHASE.programSlug,
      destinationProgramId: UNITED.programId,
      destinationProgramSlug: UNITED.programSlug,
      ratioBasisPoints: 10000,
    },
  ],
  awardOptions: [
    {
      awardId: "00000000-0000-0000-0000-00000000f001",
      awardSlug: "award:demo_hyatt_ginza:tokyo:3n",
      displayName: "Demo Hyatt Ginza 3-night Tokyo award",
      programId: HYATT.programId,
      programSlug: HYATT.programSlug,
      pointsRequired: 45000,
      valueBasisPoints: 23333,
      available: true,
    },
    {
      awardId: "00000000-0000-0000-0000-00000000f002",
      awardSlug: "award:demo_united_tokyo:3n",
      displayName: "United MileagePlus Tokyo saver award",
      programId: UNITED.programId,
      programSlug: UNITED.programSlug,
      pointsRequired: 60000,
      valueBasisPoints: 15000,
      available: true,
    },
  ],
  goal: { destination: "Tokyo", category: "hotel_award", nights: 3 },
  query: CANONICAL_QUERY,
};

const WALLETS_BY_ID: Record<ApprovedWalletId, CanonicalWalletFacts> = {
  "transfer-required": TRANSFER_REQUIRED_WALLET,
};

export function isApprovedWalletId(value: unknown): value is ApprovedWalletId {
  return typeof value === "string" && (APPROVED_WALLET_IDS as readonly string[]).includes(value);
}

/** Resolve canonical public facts for an approved wallet id, or undefined. */
export function getCanonicalWallet(walletId: string): CanonicalWalletFacts | undefined {
  return isApprovedWalletId(walletId) ? WALLETS_BY_ID[walletId] : undefined;
}

/** All known program/award identifiers (UUID + slug) — the grounding vocabulary. */
export function knownAwardIdentifiers(facts: CanonicalWalletFacts): Set<string> {
  const ids = new Set<string>();
  for (const award of facts.awardOptions) {
    ids.add(award.awardId);
    ids.add(award.awardSlug);
  }
  return ids;
}

export function knownProgramIdentifiers(facts: CanonicalWalletFacts): Set<string> {
  const ids = new Set<string>();
  for (const program of facts.programs) {
    ids.add(program.programId);
    ids.add(program.programSlug);
  }
  return ids;
}
