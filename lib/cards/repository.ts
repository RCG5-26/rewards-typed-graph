/**
 * Cards repository — swappable data source behind `/api/cards`.
 *
 * Today the canonical demo seed lives only in `fixtures/demo-seed.json`
 * (Postgres isn't provisioned and `.env` has no `DATABASE_URL`), so the fixture
 * adapter is the default. The Postgres adapter is wired but lazy: it only loads
 * the `pg` driver when `DATABASE_URL` is set, so the Next build stays green
 * without `pg` installed. Flip the source by exporting `DATABASE_URL` and
 * loading the same seed via `scripts/load_seed.py` — the `CardView` shape and
 * every consumer stay identical.
 */

import { promises as fs } from "fs";
import path from "path";

import { faceForSlug } from "./presentation";
import { CPP_CENTS, type CardsRepository, type CardView } from "./types";

const BASIS_POINTS_PER_X = 10000;

// ── Shapes of the seed rows we read (subset of fixtures/demo-seed.json) ──
interface SeedProgram {
  id: string;
  name: string;
  currency_name: string;
}
interface SeedCard {
  id: string;
  slug: string;
  name: string;
  issuer: string;
  network: string;
  annual_fee_cents: number;
  reward_program_id: string;
  signup_bonus_points: number | null;
  is_active: boolean;
}
interface SeedCategory {
  id: string;
  name: string;
}
interface SeedEarn {
  credit_card_id: string;
  spend_category_id: string;
  earn_rate_basis_points: number;
}
interface DemoSeed {
  reward_programs: SeedProgram[];
  credit_cards: SeedCard[];
  spend_categories: SeedCategory[];
  earns: SeedEarn[];
}

/** One row of the Postgres adapter's join query. */
interface PgCardRow {
  id: string;
  slug: string;
  name: string;
  issuer: string;
  network: string;
  annual_fee_cents: number;
  signup_bonus_points: number | null;
  program_name: string;
  currency_name: string;
  rate: string | null;
}

/** Top earn row → "3× travel" label (10000 bp = 1×). */
function deriveRate(
  cardId: string,
  earns: SeedEarn[],
  categoriesById: Map<string, SeedCategory>,
): string {
  const top = earns
    .filter((e) => e.credit_card_id === cardId)
    .sort((a, b) => b.earn_rate_basis_points - a.earn_rate_basis_points)[0];
  if (!top) return "—";
  const multiplier = top.earn_rate_basis_points / BASIS_POINTS_PER_X;
  const category = categoriesById.get(top.spend_category_id)?.name ?? "spend";
  // Trim a trailing ".0" so 3.0 → "3", but keep 1.5.
  const label = Number.isInteger(multiplier)
    ? String(multiplier)
    : multiplier.toFixed(1);
  return `${label}× ${category.toLowerCase()}`;
}

/** Net first-year estimate, in cents: bonus pts @ CPP minus annual fee. */
function firstYearValueCents(card: SeedCard): number {
  const bonusValue = Math.round((card.signup_bonus_points ?? 0) * CPP_CENTS);
  return bonusValue - card.annual_fee_cents;
}

function toCardView(seed: DemoSeed): CardView[] {
  const programsById = new Map(seed.reward_programs.map((p) => [p.id, p]));
  const categoriesById = new Map(seed.spend_categories.map((c) => [c.id, c]));

  return seed.credit_cards
    .filter((c) => c.is_active)
    .map((c) => {
      const program = programsById.get(c.reward_program_id);
      const { face, accent } = faceForSlug(c.slug);
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        bank: c.issuer,
        network: c.network,
        annualFeeCents: c.annual_fee_cents,
        programName: program?.name ?? "Rewards",
        currencyName: program?.currency_name ?? "points",
        signupBonusPoints: c.signup_bonus_points,
        rate: deriveRate(c.id, seed.earns, categoriesById),
        firstYearValueCents: firstYearValueCents(c),
        face,
        accent,
      };
    });
}

// ── Fixture adapter (default) ──
// Cards come only from the seed `credit_cards` (no invented catalog). Expanding
// the picker means adding vetted rows to the seed or wiring a card-rewards API —
// the Postgres adapter already reads whatever `credit_cards` contains.
class FixtureCardsRepository implements CardsRepository {
  async listCards(): Promise<CardView[]> {
    const file = path.join(process.cwd(), "fixtures", "demo-seed.json");
    const raw = await fs.readFile(file, "utf-8");
    return toCardView(JSON.parse(raw) as DemoSeed);
  }
}

// ── Postgres adapter (lazy — only when DATABASE_URL is set) ──
class PostgresCardsRepository implements CardsRepository {
  constructor(private readonly connectionString: string) {}

  async listCards(): Promise<CardView[]> {
    // Dynamic import keeps `pg` out of the default build; add it to the app's
    // deps before pointing DATABASE_URL at a live database. The `pg` types are
    // not installed by default, so the optional driver is loaded untyped.
    // `webpackIgnore` keeps the optional driver a true runtime import so the
    // Next build doesn't try to resolve/bundle `pg` when it isn't installed.
    // @ts-expect-error optional peer dependency, present only when DATABASE_URL is set
    const pg = await import(/* webpackIgnore: true */ "pg");
    const client = new pg.Client({ connectionString: this.connectionString });
    await client.connect();
    try {
      const result: { rows: PgCardRow[] } = await client.query(`
        SELECT c.id, c.slug, c.name, c.issuer, c.network,
               c.annual_fee_cents, c.signup_bonus_points,
               p.name AS program_name, p.currency_name,
               (
                 SELECT (e.earn_rate_basis_points / 10000.0)::text || '× ' || lower(sc.name)
                 FROM earns e
                 JOIN spend_categories sc ON sc.id = e.spend_category_id
                 WHERE e.credit_card_id = c.id
                 ORDER BY e.earn_rate_basis_points DESC
                 LIMIT 1
               ) AS rate
        FROM credit_cards c
        JOIN reward_programs p ON p.id = c.reward_program_id
        WHERE c.is_active = true
        ORDER BY c.annual_fee_cents DESC
      `);
      return result.rows.map((r) => {
        const { face, accent } = faceForSlug(r.slug);
        const bonusValue = Math.round((r.signup_bonus_points ?? 0) * CPP_CENTS);
        return {
          id: r.id,
          slug: r.slug,
          name: r.name,
          bank: r.issuer,
          network: r.network,
          annualFeeCents: r.annual_fee_cents,
          programName: r.program_name,
          currencyName: r.currency_name,
          signupBonusPoints: r.signup_bonus_points,
          rate: r.rate ?? "—",
          firstYearValueCents: bonusValue - r.annual_fee_cents,
          face,
          accent,
        };
      });
    } finally {
      await client.end();
    }
  }
}

/** Pick the adapter: Postgres when `DATABASE_URL` is set, else the fixture. */
export function getCardsRepository(): CardsRepository {
  const url = process.env.DATABASE_URL;
  return url
    ? new PostgresCardsRepository(url)
    : new FixtureCardsRepository();
}
