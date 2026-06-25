/**
 * Card data contracts for the onboarding flow.
 *
 * `CardView` is what `/api/cards` returns: the real seed fields (identity, fee,
 * program, signup bonus) joined with a derived earn `rate` label and a small
 * presentational face/accent map. Everything except `face`/`accent` comes from
 * the canonical demo seed (`fixtures/demo-seed.json` → `demo-seed-v1`, the same
 * rows `scripts/load_seed.py` writes to Postgres), so swapping the fixture
 * adapter for a Postgres adapter changes the source, not this shape.
 */

/** Earn type as stored on the seed `earns` rows. */
export type EarnType = "points" | "miles";

export interface CardView {
  /** Stable seed UUID (matches the `credit_cards.id` Postgres row). */
  id: string;
  /** Seed slug, e.g. `card:chase_sapphire_reserve` — the presentation key. */
  slug: string;
  name: string;
  /** Issuer, shown as the card "bank" label. */
  bank: string;
  network: string;
  annualFeeCents: number;
  /** Joined `reward_programs.name`, e.g. "Chase Ultimate Rewards". */
  programName: string;
  /** Currency unit for the program ("points" | "miles"). */
  currencyName: string;
  signupBonusPoints: number | null;
  /** Derived from the card's top `earns` row, e.g. "3× travel". */
  rate: string;
  /**
   * Estimated net first-year value in cents, derived purely from seed fields:
   * signup-bonus points valued at {@link CPP_CENTS}¢/pt, minus the annual fee.
   * Honest demo math — labelled "est." in the UI, not a guarantee.
   */
  firstYearValueCents: number;
  /** Presentational card-face gradient (CSS background value). */
  face: string;
  /** Presentational accent hex (stripe + rate text). */
  accent: string;
}

/** Cents-per-point used for the first-year value estimate. */
export const CPP_CENTS = 1.5;

/** The data source for cards. Fixture today, Postgres when wired. */
export interface CardsRepository {
  listCards(): Promise<CardView[]>;
}
