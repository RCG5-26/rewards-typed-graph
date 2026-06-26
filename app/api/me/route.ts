import "server-only";

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { resolveSessionGraph } from "@/lib/user/session";

/**
 * GET /api/me — provisions the backend session, then returns the signed-in
 * user's personal graph for onboarding (balances, goals, holds). Identity is
 * overlaid from Clerk per ADR 0006. Returns 401 when there is no session,
 * 403 when the account is not yet provisioned.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { getToken, userId } = await auth();
    const token = await getToken();
    if (!token || !userId) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    // Provision/validate the backend session for this Clerk identity (surfaces
    // 401/403 from Hono). Bind the Hono-provisioned principal to the same Clerk
    // user the graph is resolved against, failing closed if they ever diverge —
    // the graph's own user.clerkId may differ (demo-persona fallback), so we
    // compare against the live Clerk session id, not the graph.
    const session = await getSession(token);
    if (session.clerkId !== userId) {
      // Fail closed without logging the principals — the Clerk ids are user
      // identifiers and must not be written to application logs.
      console.error("session identity mismatch between Hono session and Clerk");
      return NextResponse.json(
        { error: "Could not load your account." },
        { status: 500 },
      );
    }
    const resolved = await resolveSessionGraph();
    if (!resolved.ok) {
      return resolved.response;
    }
    return NextResponse.json(resolved.graph);
  } catch (err) {
    if (err instanceof ApiError) {
      const status = "status" in err.kind ? err.kind.status : 500;
      if (err.kind.kind === "not-signed-in") {
        return NextResponse.json({ error: "Not signed in." }, { status });
      }
      if (err.kind.kind === "unprovisioned") {
        return NextResponse.json({ error: "Account not provisioned." }, { status });
      }
      return NextResponse.json({ error: "Could not load your account." }, { status });
    }
    console.error("GET /api/me failed", err);
    return NextResponse.json({ error: "Could not load your account." }, { status: 500 });
  }
}
