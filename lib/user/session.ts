import "server-only";

import { NextResponse } from "next/server";

import { getCurrentUserGraph } from "./current";
import { UnmappedUserError } from "./repository";
import type { UserGraph } from "./types";

/**
 * Resolve the signed-in user's graph for a route handler, mapping the failure
 * modes to JSON responses so every route (including the SSE stream, which
 * resolves before opening its body) returns a consistent, parseable error
 * instead of an HTML 500:
 *   - no session            → 401
 *   - authenticated, no row  → 403 (UnmappedUserError; never leaks another user)
 *   - anything else          → 500
 */
export type SessionResolution =
  | { ok: true; graph: UserGraph }
  | { ok: false; response: NextResponse };

export async function resolveSessionGraph(): Promise<SessionResolution> {
  try {
    const graph = await getCurrentUserGraph();
    if (!graph) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Not signed in." }, { status: 401 }),
      };
    }
    return { ok: true, graph };
  } catch (err) {
    if (err instanceof UnmappedUserError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "No account is provisioned for this sign-in." },
          { status: 403 },
        ),
      };
    }
    console.error("resolveSessionGraph failed", err);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Could not load your account." },
        { status: 500 },
      ),
    };
  }
}
