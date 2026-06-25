import { NextResponse } from "next/server";

import { getCardsRepository } from "@/lib/cards/repository";

/**
 * GET /api/cards — the catalog of real seed cards for onboarding.
 *
 * Reads from the swappable cards repository (fixture today, Postgres when
 * `DATABASE_URL` is set). Node runtime + no caching: the fixture adapter reads
 * from disk and a live DB must not be cached behind the demo.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cards = await getCardsRepository().listCards();
    return NextResponse.json({ cards });
  } catch (err) {
    console.error("GET /api/cards failed", err);
    return NextResponse.json(
      { error: "Could not load cards." },
      { status: 500 },
    );
  }
}
