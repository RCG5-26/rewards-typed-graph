/**
 * Current-user contracts: the personal-graph slice resolved from a Clerk
 * session.
 *
 * The signed-in identity comes from Clerk (`clerk_id`); everything else — the
 * balances, goals, and held cards — is the seeded `personal`-tier graph for that
 * user (`fixtures/demo-seed.json` today, Postgres when `DATABASE_URL` is set).
 * Mirrors the cards repository's fixture-first, DB-ready split.
 */

export interface CurrentUser {
  /** Seed `users.id` (the personal-graph owner UUID). */
  id: string;
  /** Clerk identity (`users.clerk_id`). */
  clerkId: string;
  email: string | null;
  displayName: string | null;
  /** True when the Clerk id didn't match a row and we fell back to the demo persona. */
  isDemoPersona: boolean;
}

export interface UserBalance {
  programId: string;
  programName: string;
  currencyName: string;
  balancePoints: number;
}

export interface UserGoal {
  id: string;
  goalType: string;
  description: string;
  targetProgramId: string | null;
  targetProgramName: string | null;
  targetLocation: string | null;
  targetDate: string | null;
}

export interface UserHold {
  cardId: string;
  cardSlug: string;
  cardName: string;
  bank: string;
  isPrimary: boolean;
}

/** The full personal-graph bundle for the signed-in user. */
export interface UserGraph {
  user: CurrentUser;
  balances: UserBalance[];
  goals: UserGoal[];
  holds: UserHold[];
}

/** Resolves a Clerk identity to its seeded personal graph. */
export interface UserRepository {
  getUserGraph(clerkId: string): Promise<UserGraph>;
}
