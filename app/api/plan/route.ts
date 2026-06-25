import { NextResponse } from "next/server";

import { buildPlan } from "@/lib/plan/builder";
import { planResultFromView } from "@/lib/plan/from-plan-view";
import {
  planQueryError,
  selectedCardIdsError,
} from "@/lib/plan/limits";
import {
  createPlanViaOrchestrator,
  isOrchestratorEnabled,
} from "@/lib/plan/orchestrator-client";
import { resolveSessionGraph } from "@/lib/user/session";

/**
 * POST /api/plan — turn a natural-language goal into a typed plan.
 *
 * Resolves the signed-in user's graph (Clerk → seed). When the real
 * orchestrator backend is configured (`API_BASE_URL`/`NEXT_PUBLIC_API_BASE_URL`),
 * the plan's identity, lifecycle, revision, and steps come from
 * `Orchestrator.run()` via `apps/api` → `hero_bridge.py` → Postgres, with the
 * typed-graph / mutation visuals projected on top. With no backend configured
 * (or on any error), it falls back to the deterministic fixture builder over the
 * seeded graph — the response contract is identical either way.
 *
 * Body: `{ queryText: string, selectedCardIds?: string[] }`
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await resolveSessionGraph();
    if (!session.ok) {
      return session.response;
    }
    const graph = session.graph;

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

    const derived = await buildPlan(graph, selectedCardIds, queryText);
    let plan = derived;
    // Skip the live overlay under a card filter — the backend plans over the
    // full wallet, which would contradict the filtered fixture projection.
    if (isOrchestratorEnabled() && selectedCardIds.length === 0) {
      try {
        const view = await createPlanViaOrchestrator(queryText);
        plan = planResultFromView(view, derived);
      } catch (err) {
        console.warn("orchestrator plan failed; using fixture plan", err);
      }
    }
    return NextResponse.json(plan);
  } catch (err) {
    console.error("POST /api/plan failed", err);
    return NextResponse.json(
      { error: "Could not build a plan." },
      { status: 500 },
    );
  }
}
