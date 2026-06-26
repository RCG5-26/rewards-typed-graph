import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { balanceTransfer, createPlan, getPlan, getSession } from "@/lib/api/client";
import { diffStale, toPlanResult, transferParamsFromPersona } from "@/lib/api/adapters";
import { planQueryError, selectedCardIdsError } from "@/lib/plan/limits";
import type { MutationLogEntry, PlanResult } from "@/lib/plan/types";

/**
 * GET /api/plan/stream — Server-Sent Events for the agent console.
 *
 * Observability stream that paces the typed mutations so coordination is
 * visible as it happens (REST `/api/plan` stays the source of truth). Events:
 *   meta         → the plan scaffold (steps, graph, route, value) sans mutations
 *   mutation     → one `graph_mutations` row, emitted ~every 320ms
 *   invalidation → (replan mode) the edge that went stale + the STALE row
 *   done         → revision complete
 *   error        → stream-level failure
 *
 * Query: `?q=<goal>&cards=<id,id>&replan=1`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PACE_MS = 320;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
      const streamMutations = async (rows: MutationLogEntry[]) => {
        for (const row of rows) {
          await sleep(PACE_MS);
          send("mutation", row);
        }
      };

      try {
        if (isReplan) {
          const session = await getSession(token);
          const params = transferParamsFromPersona(session);
          const transferResult = await balanceTransfer(params, token);

          if (!transferResult.staledPlanId) {
            throw new Error("balance transfer did not return the staled plan id");
          }

          const priorPlan = await getPlan(transferResult.staledPlanId, token);
          const invalidation = diffStale(priorPlan, transferResult.currentPlan);
          const rev2 = toPlanResult(transferResult.currentPlan);

          await sleep(PACE_MS);
          send("invalidation", invalidation);
          send("meta", metaOf(rev2));
          await streamMutations(rev2.mutations);
          send("done", {
            revision: rev2.revision,
            planValueCents: rev2.planValueCents,
            route: rev2.route,
            status: rev2.status,
          });
        } else {
          const apiPlan = await createPlan(queryText, token);
          const plan = toPlanResult(apiPlan);
          send("meta", metaOf(plan));
          await streamMutations(plan.mutations);
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
