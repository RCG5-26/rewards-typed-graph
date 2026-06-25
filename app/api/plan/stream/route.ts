import { NextResponse } from "next/server";

import { buildPlan, buildReplan } from "@/lib/plan/builder";
import { planResultFromView } from "@/lib/plan/from-plan-view";
import {
  planQueryError,
  selectedCardIdsError,
} from "@/lib/plan/limits";
import {
  createPlanViaOrchestrator,
  fetchMutationsViaOrchestrator,
  isOrchestratorEnabled,
  latestMutationCursor,
  streamMutationsViaOrchestrator,
  transferBalanceViaOrchestrator,
} from "@/lib/plan/orchestrator-client";
import { makeRealMutationMapper, realMutationsToLog } from "@/lib/plan/real-mutations";
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
 * session cookie automatically, so middleware still gates it.
 *
 * When `API_BASE_URL`/`NEXT_PUBLIC_API_BASE_URL` is set, the authoritative plan
 * (identity, lifecycle, revision, steps) comes from the real orchestrator
 * backend (`apps/api` → `hero_bridge.py` → Postgres) and the typed-graph /
 * mutation visuals are projected onto it; with no backend configured (or on any
 * error) it falls back to the deterministic fixture builder so the demo always
 * runs. See `lib/plan/orchestrator-client.ts`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PACE_MS = 320;
/** Hold between the invalidation and the new revision so the stale ripple shows. */
const RIPPLE_HOLD_MS = 1100;
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

      const done = (plan: PlanResult) =>
        send("done", { revision: plan.revision, planValueCents: plan.planValueCents, route: plan.route, status: plan.status });

      /**
       * Overlay the real `graph_mutations` rows this write produced (since
       * `cursor`, scoped to the plan lineage) onto the projected plan, so the
       * log streams Postgres rows instead of the seed-derived ones. Best-effort:
       * on any failure or an empty result, keep the derived mutations.
       */
      const withRealMutations = async (
        plan: PlanResult,
        derived: PlanResult,
        cursor: number,
        lineageId: string | null,
        seqStart: number,
      ): Promise<PlanResult> => {
        try {
          const events = (await fetchMutationsViaOrchestrator(cursor)).filter(
            (e) => !lineageId || e.plan_lineage_id === lineageId,
          );
          if (!events.length) return plan;
          return { ...plan, mutations: realMutationsToLog(events, derived, seqStart) };
        } catch (err) {
          console.warn("fetching real mutations failed; using derived log", err);
          return plan;
        }
      };

      /**
       * Live tail: subscribe to the Graph lane's `GET /mutations/stream` from
       * `cursor` and forward each lineage row as a `mutation` event the moment
       * it arrives — no client-side re-pacing. Stops on an idle gap (the write
       * already committed, so rows arrive up-front) or a hard cap. Returns the
       * count forwarded so the caller can fall back when nothing came through.
       */
      const liveForward = async (
        cursor: number,
        lineageId: string | null,
        derived: PlanResult,
        seqStart: number,
      ): Promise<number> => {
        const IDLE_MS = 2000;
        const MAX_MS = 9000;
        const controller = new AbortController();
        const map = makeRealMutationMapper(derived, seqStart);
        let count = 0;
        let idle: ReturnType<typeof setTimeout> | null = null;
        const resetIdle = () => {
          if (idle) clearTimeout(idle);
          idle = setTimeout(() => controller.abort(), IDLE_MS);
        };
        const hard = setTimeout(() => controller.abort(), MAX_MS);
        resetIdle();
        try {
          await streamMutationsViaOrchestrator(
            cursor,
            (ev) => {
              if (lineageId && ev.plan_lineage_id !== lineageId) return;
              send("mutation", map(ev));
              count += 1;
              resetIdle();
            },
            controller.signal,
          );
        } catch (err) {
          // AbortError is our normal stop; surface only genuine failures.
          if ((err as Error)?.name !== "AbortError") {
            console.warn("live mutation tail failed", err);
          }
        } finally {
          if (idle) clearTimeout(idle);
          clearTimeout(hard);
        }
        return count;
      };

      try {
        if (isReplan) {
          const replan = await buildReplan(graph, selectedCardIds, queryText);
          if (!replan) {
            send("error", { message: "No replan path available." });
            return;
          }
          // Persist the real transfer + re-plan when a backend is wired; project
          // its authoritative revision-2 onto the fixture's invalidation visual.
          let plan = replan.plan;
          let live: { cursor: number; lineageId: string } | null = null;
          if (isOrchestratorEnabled() && replan.transfer) {
            try {
              const cursor = await latestMutationCursor();
              const result = await transferBalanceViaOrchestrator(replan.transfer);
              plan = planResultFromView(result.currentPlan, replan.plan);
              live = { cursor, lineageId: result.planLineageId };
            } catch (err) {
              console.warn("orchestrator replan failed; using fixture re-plan", err);
            }
          }
          await sleep(PACE_MS);
          send("invalidation", replan.invalidation);
          // hold so the stale ripple is visible on the (still revision-1) plan
          // dependency graph before the new revision replaces it
          await sleep(RIPPLE_HOLD_MS);
          send("meta", metaOf(plan));
          const seqStart = replan.invalidation.mutation.seq + 1;
          if (live) {
            const forwarded = await liveForward(live.cursor, live.lineageId, replan.plan, seqStart);
            if (forwarded === 0) {
              const real = await withRealMutations(plan, replan.plan, live.cursor, live.lineageId, seqStart);
              await streamMutations(real.mutations);
            }
          } else {
            await streamMutations(plan.mutations);
          }
          done(plan);
        } else {
          const derived = await buildPlan(graph, selectedCardIds, queryText);
          let plan = derived;
          let live: { cursor: number; lineageId: string } | null = null;
          if (isOrchestratorEnabled()) {
            try {
              const cursor = await latestMutationCursor();
              const view = await createPlanViaOrchestrator(queryText);
              plan = planResultFromView(view, derived); // real header/steps; mutations TBD
              live = { cursor, lineageId: view.planLineageId };
            } catch (err) {
              console.warn("orchestrator plan failed; using fixture plan", err);
            }
          }
          send("meta", metaOf(plan));
          if (live) {
            // live tail → one-shot fetch → derived, in order of fidelity
            const forwarded = await liveForward(live.cursor, live.lineageId, derived, 1);
            if (forwarded === 0) {
              const real = await withRealMutations(plan, derived, live.cursor, live.lineageId, 1);
              await streamMutations(real.mutations);
            }
          } else {
            await streamMutations(plan.mutations);
          }
          done(plan);
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
