import "server-only";

import { NextResponse } from "next/server";

import { getTestWallets, PublicApiError } from "@/lib/comparison/client";

/**
 * GET /api/demo/test-wallets — proxy to the public Hono demo facts route.
 *
 * Exposes the canonical, seed-verified wallet facts (programs, balances,
 * transfer routes, award options) to client components. The onboarding ask/plan
 * steps consume the transfer routes + award options here as the "what the agents
 * see" data — the same real facts the /test-wallets page shows. Unauthenticated
 * upstream (fixed demo persona), so no token is forwarded.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getTestWallets());
  } catch (err) {
    if (err instanceof PublicApiError) {
      const status = err.status >= 400 && err.status < 600 ? err.status : 502;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("GET /api/demo/test-wallets failed", err);
    return NextResponse.json({ error: "Could not load wallet facts." }, { status: 502 });
  }
}
