import { type Context } from "hono";
import { HTTPException } from "hono/http-exception";

/**
 * Auth contract shared by every route group: an upstream middleware resolves the
 * Clerk token to a `users.id` and stores it on the context. Routes never read
 * the token themselves — they only ask for the resolved id.
 */
export type AuthVariables = {
  userId?: string;
};

export type AuthEnv = {
  Variables: AuthVariables;
};

export function getAuthenticatedUserId(c: Context<AuthEnv>): string {
  const userId = c.get("userId");
  if (!userId) {
    throw new HTTPException(401, { message: "authentication required" });
  }
  return userId;
}
