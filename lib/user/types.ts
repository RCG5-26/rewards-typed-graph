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
  /** Avatar from the Clerk/Google identity, if any. */
  imageUrl: string | null;
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

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCurrentUser(value: unknown): value is CurrentUser {
  if (!value || typeof value !== "object") return false;
  const user = value as CurrentUser;
  return (
    typeof user.id === "string" &&
    typeof user.clerkId === "string" &&
    isNullableString(user.email) &&
    isNullableString(user.displayName) &&
    isNullableString(user.imageUrl) &&
    typeof user.isDemoPersona === "boolean"
  );
}

function isUserBalance(value: unknown): value is UserBalance {
  if (!value || typeof value !== "object") return false;
  const balance = value as UserBalance;
  return (
    typeof balance.programId === "string" &&
    typeof balance.programName === "string" &&
    typeof balance.currencyName === "string" &&
    // Finite guards against NaN/Infinity, which would poison the points sum.
    Number.isFinite(balance.balancePoints)
  );
}

/**
 * Runtime guard for `/api/me` and client bootstrap. Validates the nested shapes
 * the consumer dereferences — the `user` identity and each balance's
 * `programName`/`balancePoints` — so a malformed payload can't slip through and
 * later throw or yield `NaN` in the points/greeting calculations.
 */
export function isUserGraph(value: unknown): value is UserGraph {
  if (!value || typeof value !== "object") return false;
  const candidate = value as UserGraph;
  return (
    isCurrentUser(candidate.user) &&
    Array.isArray(candidate.balances) &&
    candidate.balances.every(isUserBalance) &&
    Array.isArray(candidate.goals) &&
    Array.isArray(candidate.holds)
  );
}

/** Resolves a Clerk identity to its seeded personal graph. */
export interface UserRepository {
  getUserGraph(clerkId: string): Promise<UserGraph>;
}
