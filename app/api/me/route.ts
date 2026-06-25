import { NextResponse } from "next/server";

import { resolveSessionGraph } from "@/lib/user/session";

/**
 * GET /api/me — the signed-in user's personal graph (identity + balances,
 * goals, and held cards), resolved from the Clerk session via `users.clerk_id`.
 * Returns 401 when there is no session, 403 when the session has no provisioned
 * account.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await resolveSessionGraph();
  if (!session.ok) {
    return session.response;
  }
  return NextResponse.json(session.graph);
}
