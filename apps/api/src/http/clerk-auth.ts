import { verifyToken } from "@clerk/backend";

export interface ResolvedIdentity {
  userId?: string;
  clerkId?: string;
  email?: string | null;
}

export interface ClerkAuthConfig {
  clerkSecretKey?: string;
  devUserId?: string;
}

export interface UserLookup {
  findUserIdByClerkId(clerkId: string): Promise<string | undefined>;
}

/**
 * Parse `Authorization: Bearer <token>`. Returns undefined for missing or
 * malformed headers so callers can treat it as unauthenticated.
 */
export function parseBearer(authorization: string | undefined): string | undefined {
  if (!authorization) {
    return undefined;
  }
  const [scheme, value] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : undefined;
}

/**
 * Resolve the caller identity from a bearer token. Production verifies the Clerk
 * JWT, then maps `sub` → users.id when a row exists. Brand-new Clerk users have
 * no row yet — only `clerkId`/`email` — and `GET /session` bootstraps the persona.
 */
export async function resolveIdentity(
  authorization: string | undefined,
  config: ClerkAuthConfig,
  lookup: UserLookup,
): Promise<ResolvedIdentity> {
  if (config.devUserId) {
    return { userId: config.devUserId };
  }

  const token = parseBearer(authorization);
  if (!token || !config.clerkSecretKey) {
    return {};
  }

  let clerkId: string;
  let email: string | null = null;
  try {
    const claims = await verifyToken(token, { secretKey: config.clerkSecretKey });
    clerkId = claims.sub;
    email = typeof claims.email === "string" ? claims.email : null;
  } catch {
    return {};
  }

  const userId = await lookup.findUserIdByClerkId(clerkId);
  return { userId, clerkId, email };
}
