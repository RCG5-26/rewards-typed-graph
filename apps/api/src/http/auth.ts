import { type Context } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * Auth contract shared by every route group: an upstream middleware verifies the
 * Clerk token and stores the resolved identity on the context. Routes never read
 * the token themselves — they ask for the resolved `userId`, or (for the session
 * bootstrap) the broader identity that may carry only a `clerkId`.
 */
export type AuthVariables = {
  userId?: string;
  clerkId?: string;
  email?: string | null;
};

export type AuthEnv = {
  Variables: AuthVariables;
};

export interface AuthIdentity {
  userId?: string;
  clerkId?: string;
  email?: string | null;
}

export function getAuthenticatedUserId(c: Context<AuthEnv>): string {
  const userId = c.get("userId");
  if (!userId) {
    throw new HTTPException(401, { message: "authentication required" });
  }
  return userId;
}

/**
 * Looser guard for the session bootstrap: a brand-new Clerk user has no `userId`
 * yet, so a valid `clerkId` alone is enough to materialize their persona.
 */
export function getAuthIdentity(c: Context<AuthEnv>): AuthIdentity {
  const userId = c.get("userId");
  const clerkId = c.get("clerkId");
  if (!userId && !clerkId) {
    throw new HTTPException(401, { message: "authentication required" });
  }
  return { userId, clerkId, email: c.get("email") ?? null };
}
