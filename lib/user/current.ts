import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";

import { getUserRepository } from "./repository";
import type { UserGraph } from "./types";

/**
 * Resolve the signed-in Clerk session to its seeded personal graph.
 *
 * The graph data (balances/goals/holds) comes from the seeded demo persona, but
 * the *identity* shown in the UI — name and avatar — is overlaid from the real
 * Clerk/Google profile so the greeting reads "welcome back, <your name>" rather
 * than the persona's seed name. Returns `null` only when there is no session.
 */
export async function getCurrentUserGraph(): Promise<UserGraph | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const graph = await getUserRepository().getUserGraph(userId);

  // Overlay the real Google/Clerk identity for display.
  const cu = await currentUser();
  if (cu) {
    const fullName =
      cu.fullName ||
      [cu.firstName, cu.lastName].filter(Boolean).join(" ") ||
      cu.username ||
      cu.primaryEmailAddress?.emailAddress?.split("@")[0] ||
      null;
    graph.user = {
      ...graph.user,
      displayName: fullName ?? graph.user.displayName,
      email: cu.primaryEmailAddress?.emailAddress ?? graph.user.email,
      imageUrl: cu.imageUrl ?? null,
    };
  }

  return graph;
}
