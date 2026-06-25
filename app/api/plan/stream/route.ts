import { NextResponse } from "next/server";

import { buildPlan, buildReplan } from "@/lib/plan/builder";
import {
  planQueryError,
  selectedCardIdsError,
} from "@/lib/plan/limits";
import type { MutationLogEntry, PlanResult } from "@/lib/plan/types";
import { resolveSessionGraph } from "@/lib/user/session";

/**
 * GET /api/plan/stream — Server-Sent Events for the agent console.
 *
 * Observability stream that paces the typed mutations so coordination is
 * visible as it happens (REST `/api/plan` stays the source of truth). Events:
 *   meta         → the plan scaffold (steps, graph, route, value) sans mutations
 *   mutation     → one `graph_mutations` row, emitted ~every 320ms
 *   invalidation → (replan mode) the edge that went stale + the STALE row
 *   done         → revision complete
 *
 * Query: `?q=<goal>&cards=<id,id>&replan=1`. EventSource sends the Clerk
 * session cookie automatically, so middleware still gates it. When the real
 * backend lands (#4) this is replaced by the orchestrator's `/mutations` SSE.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PACE_MS = 320;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(request: Request) {
  const session = await resolveSessionGraph();
  if (!session.ok) {
    return session.response;
  }
  const graph = session.graph;

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
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
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
          const replan = await buildReplan(graph, selectedCardIds, queryText);
          if (!replan) {
            send("error", { message: "No replan path available." });
            return;
          }
          await sleep(PACE_MS);
          send("invalidation", replan.invalidation);
          send("meta", metaOf(replan.plan));
          await streamMutations(replan.plan.mutations);
          send("done", { revision: replan.plan.revision, planValueCents: replan.plan.planValueCents, route: replan.plan.route, status: replan.plan.status });
        } else {
          const plan = await buildPlan(graph, selectedCardIds, queryText);
          send("meta", metaOf(plan));
          await streamMutations(plan.mutations);
          send("done", { revision: plan.revision, planValueCents: plan.planValueCents, route: plan.route, status: plan.status });
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
