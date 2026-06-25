import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { createPlan } from "@/lib/api/client";
import { toPlanResult } from "@/lib/api/adapters";
import { ApiError } from "@/lib/api/types";
import {
  planQueryError,
  selectedCardIdsError,
} from "@/lib/plan/limits";

/**
 * POST /api/plan — turn a natural-language goal into a typed plan.
 *
 * Forwards `queryText` to the live Hono API (POST /plans) and maps the
 * response to a PlanResult via toPlanResult(). `selectedCardIds` is
 * validated locally but not forwarded — the API does not yet accept it.
 *
 * Body: `{ queryText: string, selectedCardIds?: string[] }`
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
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

    const { getToken } = await auth();
    const token = await getToken();
    if (!token) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    // selectedCardIds accepted but not forwarded — API does not yet support it
    const apiPlan = await createPlan(queryText, token);
    const result = toPlanResult(apiPlan);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      const kind = err.kind;
      if (kind.kind === "not-signed-in") {
        return NextResponse.json({ error: "Not signed in." }, { status: 401 });
      }
      if (kind.kind === "unprovisioned") {
        return NextResponse.json({ error: "Account not provisioned." }, { status: 403 });
      }
    }
    console.error("POST /api/plan failed", err);
    return NextResponse.json(
      { error: "Could not build a plan." },
      { status: 500 },
    );
  }
}
