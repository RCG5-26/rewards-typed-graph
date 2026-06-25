import "server-only";

import { auth } from "@clerk/nextjs/server";

import { getUserRepository } from "./repository";
import type { UserGraph } from "./types";

/**
 * Resolve the signed-in Clerk session to its seeded personal graph.
 *
 * This is the Clerk → `users.clerk_id` → balances/goals/holds join. Returns
 * `null` only when there is no session (middleware should already prevent that
 * on protected routes). Server-only — it reads the Clerk session via `auth()`.
 */
export async function getCurrentUserGraph(): Promise<UserGraph | null> {
  const { userId } = await auth();
  if (!userId) return null;
  return getUserRepository().getUserGraph(userId);
}
