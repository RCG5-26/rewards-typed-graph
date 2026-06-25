import { NextResponse } from "next/server";

import { getCurrentUserGraph } from "@/lib/user/current";

/**
 * GET /api/me — the signed-in user's personal graph (identity + balances,
 * goals, and held cards), resolved from the Clerk session via `users.clerk_id`.
 * Returns 401 when there is no session.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const graph = await getCurrentUserGraph();
    if (!graph) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    return NextResponse.json(graph);
  } catch (err) {
    console.error("GET /api/me failed", err);
    return NextResponse.json(
      { error: "Could not load your account." },
      { status: 500 },
    );
  }
}
