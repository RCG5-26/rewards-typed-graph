import { NextResponse } from "next/server";

import { runArchitectureComparison } from "@/lib/comparison/client";

/**
 * POST /api/demo/architecture-comparison — proxy to the public Hono comparison
 * endpoint. The browser cannot reach the Hono API directly (no public base URL),
 * so this server route forwards the request. The endpoint is unauthenticated by
 * design (fixed demo persona), so no Clerk token is attached.
 *
 * Body: `{ walletId: string }`. The query is NOT accepted here — the demo runs
 * one fixed canonical query, so the proxy never forwards a client-supplied query
 * (review Fix 5). The API enforces the same rule server-side.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      walletId?: unknown;
    };
    if (typeof body.walletId !== "string" || body.walletId.length === 0) {
      return NextResponse.json({ error: "walletId is required." }, { status: 400 });
    }

    const response = await runArchitectureComparison(body.walletId);
    return NextResponse.json(response);
  } catch (err) {
    console.error("POST /api/demo/architecture-comparison failed", err);
    return NextResponse.json({ error: "Could not run the comparison." }, { status: 502 });
  }
}
