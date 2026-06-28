import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { balanceTransfer, createPlan, getPlan, getSession } from "@/lib/api/client";
import { diffStale, toPlanResult, transferParamsFromPersona } from "@/lib/api/adapters";
import { planQueryError, selectedCardIdsError } from "@/lib/plan/limits";
import type { ApiTransferParams } from "@/lib/api/types";
import type { PlanResult } from "@/lib/plan/types";

/**
 * Read a user-entered transfer from the query string (`?src=&dest=&amt=`).
 * Returns null when none is supplied, so the caller can fall back to the seeded
 * persona's scripted transfer (back-compat with the demo trigger).
 */
function userTransferParams(url: URL): ApiTransferParams | null {
  const sourceProgramId = url.searchParams.get("src")?.trim();
  const destProgramId = url.searchParams.get("dest")?.trim();
  const amountPoints = Number(url.searchParams.get("amt"));
  if (!sourceProgramId || !destProgramId) return null;
  return { sourceProgramId, destProgramId, amountPoints };
}

/**
 * GET /api/plan/stream — Server-Sent Events for the agent console.
 *
 * Observability stream for plan scaffolding (REST `/api/plan` stays the source
 * of truth). Real `graph_mutations` rows now stream separately from
 * `/api/mutations/stream`; this route no longer paces or emits mutation frames.
 * Events:
 *   meta         → the plan scaffold (steps, graph, route, value) sans mutations
 *   invalidation → (replan mode) the edge that went stale + the STALE row
 *   done         → revision complete
 *   error        → stream-level failure
 *
 * Query: `?q=<goal>&cards=<id,id>&replan=1`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const queryText = (url.searchParams.get("q") ?? "").trim();
  const queryError = planQueryError(queryText);
  if (queryError) {
    return NextResponse.json({ error: queryError }, { status: 400 });
  }
  const selectedCardIds = (url.searchParams.get("cards") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const cardsError = selectedCardIdsError(selectedCardIds);
  if (cardsError) {
    return NextResponse.json({ error: cardsError }, { status: 400 });
  }
  const isReplan = url.searchParams.get("replan") === "1";
  const transfer = userTransferParams(url);
  if (isReplan && transfer && !(transfer.amountPoints > 0)) {
    return NextResponse.json({ error: "Transfer amount must be a positive number." }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const metaOf = (plan: PlanResult) => {
        const { mutations: _omit, ...meta } = plan;
        void _omit;
        return meta;
      };

      try {
        if (isReplan) {
          // User-entered transfer wins; otherwise fall back to the seeded
          // persona's scripted transfer (the original demo trigger).
          const params = transfer ?? transferParamsFromPersona(await getSession(token));
          const transferResult = await balanceTransfer(params, token);

          if (!transferResult.staledPlanId) {
            throw new Error("balance transfer did not return the staled plan id");
          }

          const priorPlan = await getPlan(transferResult.staledPlanId, token);
          const invalidation = diffStale(priorPlan, transferResult.currentPlan);
          const rev2 = toPlanResult(transferResult.currentPlan);

          send("invalidation", invalidation);
          send("meta", metaOf(rev2));
          send("done", {
            revision: rev2.revision,
            planValueCents: rev2.planValueCents,
            route: rev2.route,
            status: rev2.status,
          });
        } else {
          const apiPlan = await createPlan(queryText, token, selectedCardIds);
          const plan = toPlanResult(apiPlan);
          send("meta", metaOf(plan));
          send("done", {
            revision: plan.revision,
            planValueCents: plan.planValueCents,
            route: plan.route,
            status: plan.status,
          });
        }
      } catch (err) {
        console.error("GET /api/plan/stream failed", err);
        send("error", { message: "Stream failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
