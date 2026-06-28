import { NextResponse } from "next/server";

import { PublicApiError, simulateDemoTransfer } from "@/lib/comparison/client";

/**
 * POST /api/demo/simulate-transfer — proxy to the public Hono demo replan route.
 * Applies the canonical Chase→Hyatt transfer for the hero persona and returns
 * revision 2 for the Graph Crew card.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      walletId?: unknown;
      idempotencyKey?: unknown;
    };
    if (typeof body.walletId !== "string" || body.walletId.length === 0) {
      return NextResponse.json({ error: "walletId is required." }, { status: 400 });
    }
    const idempotencyKey =
      typeof body.idempotencyKey === "string" && body.idempotencyKey.trim().length > 0
        ? body.idempotencyKey.trim()
        : undefined;

    const response = await simulateDemoTransfer(body.walletId, idempotencyKey);
    return NextResponse.json(response);
  } catch (err) {
    // Forward the upstream status/message (e.g. 503 PLAN_ENGINE misconfig, 400
    // bad input) so the UI can show an actionable reason instead of a blanket
    // gateway error. Non-API failures still fall back to a generic 502.
    if (err instanceof PublicApiError) {
      const status = err.status >= 400 && err.status < 600 ? err.status : 502;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("POST /api/demo/simulate-transfer failed", err);
    return NextResponse.json({ error: "Could not simulate the transfer." }, { status: 502 });
  }
}
