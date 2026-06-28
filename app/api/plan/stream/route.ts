import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { balanceTransfer, createPlan, getPlan, getSession } from "@/lib/api/client";
import { diffStale, toPlanResult, transferParamsFromPersona } from "@/lib/api/adapters";
import { planQueryError, selectedCardIdsError } from "@/lib/plan/limits";
import type { ApiTransferParams } from "@/lib/api/types";
import type { PlanResult } from "@/lib/plan/types";

type TransferParse =
  | { kind: "none" }
  | { kind: "invalid"; message: string }
  | { kind: "ok"; params: ApiTransferParams };

/**
 * Parse a user-entered transfer from the query string (`?src=&dest=&amt=`).
 *
 * Fail-closed: if the caller supplies *any* of the three params it must supply a
 * complete, valid tuple — otherwise we reject (`invalid`) rather than silently
 * falling back to the seeded persona transfer (which would fire an unintended
 * demo transfer). Only when *none* are present do we return `none` so the caller
 * uses the persona fallback.
 */
function parseUserTransfer(url: URL): TransferParse {
  const rawSrc = url.searchParams.get("src");
  const rawDest = url.searchParams.get("dest");
  const rawAmt = url.searchParams.get("amt");
  if (rawSrc === null && rawDest === null && rawAmt === null) return { kind: "none" };

  const sourceProgramId = rawSrc?.trim() ?? "";
  const destProgramId = rawDest?.trim() ?? "";
  const amountPoints = Number(rawAmt);
  if (!sourceProgramId || !destProgramId) {
    return { kind: "invalid", message: "Transfer requires both a source and destination program." };
  }
  if (sourceProgramId === destProgramId) {
    return { kind: "invalid", message: "Transfer source and destination must differ." };
  }
  if (!Number.isFinite(amountPoints) || amountPoints <= 0) {
    return { kind: "invalid", message: "Transfer amount must be a positive number." };
  }
  return { kind: "ok", params: { sourceProgramId, destProgramId, amountPoints } };
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
  const transfer = parseUserTransfer(url);
  if (isReplan && transfer.kind === "invalid") {
    return NextResponse.json({ error: transfer.message }, { status: 400 });
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
          // A valid user-entered transfer wins; with none supplied, fall back to
          // the seeded persona's scripted transfer (the original demo trigger).
          const params =
            transfer.kind === "ok"
              ? transfer.params
              : transferParamsFromPersona(await getSession(token));
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
