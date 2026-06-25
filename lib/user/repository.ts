/**
 * User repository — resolves a Clerk identity to its seeded personal graph.
 *
 * A real Google sign-in yields a Clerk id like `user_2ab…`, which won't match
 * the seed's `clerk_hero_demo`. So we look the id up first and, when absent,
 * fall back to the single seeded demo persona (`isDemoPersona: true`). That is
 * the deliberate "identity-only, per-user demo persona" wiring from ADR-0006:
 * any signed-in session drives the Tokyo hero graph until real personal graphs
 * are ingested. Fixture-first / Postgres-ready, same as the cards repository.
 */

import { promises as fs } from "fs";
import path from "path";

import type {
  CurrentUser,
  UserBalance,
  UserGoal,
  UserGraph,
  UserHold,
  UserRepository,
} from "./types";

// ── Subset of fixtures/demo-seed.json we read ──
interface SeedUser {
  id: string;
  clerk_id: string;
  email: string | null;
  display_name: string | null;
}
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
}
interface SeedBalance {
  user_id: string;
  program_id: string;
  balance_points: number;
}
interface SeedGoal {
  id: string;
  user_id: string;
  goal_type: string;
  description: string;
  target_program_id: string | null;
  target_location: string | null;
  target_date: string | null;
}
interface SeedHold {
  user_id: string;
  credit_card_id: string;
  is_primary: boolean;
}
interface DemoSeed {
  users: SeedUser[];
  reward_programs: SeedProgram[];
  credit_cards: SeedCard[];
  user_balances: SeedBalance[];
  user_goals: SeedGoal[];
  holds: SeedHold[];
}

function buildGraph(seed: DemoSeed, clerkId: string): UserGraph {
  const matched = seed.users.find((u) => u.clerk_id === clerkId);
  const seedUser = matched ?? seed.users[0];
  if (!seedUser) {
    throw new Error("demo seed has no users to resolve");
  }

  const user: CurrentUser = {
    id: seedUser.id,
    clerkId,
    email: seedUser.email,
    displayName: seedUser.display_name,
    isDemoPersona: !matched,
  };

  const programsById = new Map(seed.reward_programs.map((p) => [p.id, p]));
  const cardsById = new Map(seed.credit_cards.map((c) => [c.id, c]));

  const balances: UserBalance[] = seed.user_balances
    .filter((b) => b.user_id === seedUser.id)
    .map((b) => {
      const program = programsById.get(b.program_id);
      return {
        programId: b.program_id,
        programName: program?.name ?? "Rewards",
        currencyName: program?.currency_name ?? "points",
        balancePoints: b.balance_points,
      };
    });

  const goals: UserGoal[] = seed.user_goals
    .filter((g) => g.user_id === seedUser.id)
    .map((g) => ({
      id: g.id,
      goalType: g.goal_type,
      description: g.description,
      targetProgramId: g.target_program_id,
      targetProgramName: g.target_program_id
        ? (programsById.get(g.target_program_id)?.name ?? null)
        : null,
      targetLocation: g.target_location,
      targetDate: g.target_date,
    }));

  const holds: UserHold[] = seed.holds
    .filter((h) => h.user_id === seedUser.id)
    .map((h) => {
      const card = cardsById.get(h.credit_card_id);
      return {
        cardId: h.credit_card_id,
        cardSlug: card?.slug ?? "",
        cardName: card?.name ?? "Card",
        bank: card?.issuer ?? "",
        isPrimary: h.is_primary,
      };
    });

  return { user, balances, goals, holds };
}

// ── Fixture adapter (default) ──
class FixtureUserRepository implements UserRepository {
  async getUserGraph(clerkId: string): Promise<UserGraph> {
    const file = path.join(process.cwd(), "fixtures", "demo-seed.json");
    const raw = await fs.readFile(file, "utf-8");
    return buildGraph(JSON.parse(raw) as DemoSeed, clerkId);
  }
}

// ── Postgres adapter (lazy — only when DATABASE_URL is set) ──
class PostgresUserRepository implements UserRepository {
  constructor(private readonly connectionString: string) {}

  async getUserGraph(clerkId: string): Promise<UserGraph> {
    // @ts-expect-error optional peer dependency, present only when DATABASE_URL is set
    const pg = await import(/* webpackIgnore: true */ "pg");
    const client = new pg.Client({ connectionString: this.connectionString });
    await client.connect();
    try {
      const userRes: { rows: SeedUser[] } = await client.query(
        `SELECT id, clerk_id, email, display_name FROM users WHERE clerk_id = $1 LIMIT 1`,
        [clerkId],
      );
      let row = userRes.rows[0];
      let isDemoPersona = false;
      if (!row) {
        const fallback: { rows: SeedUser[] } = await client.query(
          `SELECT id, clerk_id, email, display_name FROM users ORDER BY created_at ASC LIMIT 1`,
        );
        row = fallback.rows[0];
        isDemoPersona = true;
      }
      if (!row) throw new Error("no users in database to resolve");

      const userId = row.id;
      const [balances, goals, holds] = await Promise.all([
        client.query(
          `SELECT b.program_id, p.name AS program_name, p.currency_name, b.balance_points
             FROM user_balances b JOIN reward_programs p ON p.id = b.program_id
            WHERE b.user_id = $1`,
          [userId],
        ),
        client.query(
          `SELECT g.id, g.goal_type, g.description, g.target_program_id,
                  p.name AS target_program_name, g.target_location, g.target_date
             FROM user_goals g LEFT JOIN reward_programs p ON p.id = g.target_program_id
            WHERE g.user_id = $1`,
          [userId],
        ),
        client.query(
          `SELECT h.credit_card_id, c.slug, c.name, c.issuer, h.is_primary
             FROM holds h JOIN credit_cards c ON c.id = h.credit_card_id
            WHERE h.user_id = $1`,
          [userId],
        ),
      ]);

      return {
        user: {
          id: row.id,
          clerkId,
          email: row.email,
          displayName: row.display_name,
          isDemoPersona,
        },
        balances: balances.rows.map((b: Record<string, unknown>) => ({
          programId: b.program_id as string,
          programName: b.program_name as string,
          currencyName: b.currency_name as string,
          balancePoints: b.balance_points as number,
        })),
        goals: goals.rows.map((g: Record<string, unknown>) => ({
          id: g.id as string,
          goalType: g.goal_type as string,
          description: g.description as string,
          targetProgramId: (g.target_program_id as string) ?? null,
          targetProgramName: (g.target_program_name as string) ?? null,
          targetLocation: (g.target_location as string) ?? null,
          targetDate: g.target_date ? String(g.target_date) : null,
        })),
        holds: holds.rows.map((h: Record<string, unknown>) => ({
          cardId: h.credit_card_id as string,
          cardSlug: h.slug as string,
          cardName: h.name as string,
          bank: h.issuer as string,
          isPrimary: h.is_primary as boolean,
        })),
      };
    } finally {
      await client.end();
    }
  }
}

/** Pick the adapter: Postgres when `DATABASE_URL` is set, else the fixture. */
export function getUserRepository(): UserRepository {
  const url = process.env.DATABASE_URL;
  return url ? new PostgresUserRepository(url) : new FixtureUserRepository();
}
