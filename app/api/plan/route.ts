import { NextResponse } from "next/server";

import { buildPlan } from "@/lib/plan/builder";
import {
  planQueryError,
  selectedCardIdsError,
} from "@/lib/plan/limits";
import { getCurrentUserGraph } from "@/lib/user/current";

/**
 * POST /api/plan — turn a natural-language goal into a typed plan.
 *
 * Resolves the signed-in user's graph (Clerk → seed), then runs the
 * fixture-backed plan builder (the orchestrator stand-in) over the seeded graph
 * to traverse balances → transfer → redemption. When the real orchestrator
 * service is wired (#3), this route calls `Orchestrator.run()` and the
 * mutations stream over SSE — the response contract stays the same.
 *
 * Body: `{ queryText: string, selectedCardIds?: string[] }`
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const graph = await getCurrentUserGraph();
    if (!graph) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      queryText?: unknown;
      selectedCardIds?: unknown;
    };
    const queryText = typeof body.queryText === "string" ? body.queryText.trim() : "";
    const queryError = planQueryError(queryText);
    if (queryError) {
      return NextResponse.json({ error: queryError }, { status: 400 });
    }
    const selectedCardIds = Array.isArray(body.selectedCardIds)
      ? body.selectedCardIds.filter((id): id is string => typeof id === "string")
      : [];
    const cardsError = selectedCardIdsError(selectedCardIds);
    if (cardsError) {
      return NextResponse.json({ error: cardsError }, { status: 400 });
    }

    const plan = await buildPlan(graph, selectedCardIds, queryText);
    return NextResponse.json(plan);
  } catch (err) {
    console.error("POST /api/plan failed", err);
    return NextResponse.json(
      { error: "Could not build a plan." },
      { status: 500 },
    );
  }
}
