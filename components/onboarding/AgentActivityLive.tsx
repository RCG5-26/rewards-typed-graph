"use client";

import { useEffect, useRef, useState } from "react";

import { mutationEventsToActivityTrace } from "@/lib/api/activity-adapter";
import type { RealMutationEvent } from "@/lib/api/types";
import type { ActivityPhase, AgentActivityTrace } from "@/lib/plan/activity";
import AgentActivity from "./AgentActivity";

/**
 * Live agent-activity panel — subscribes to the **real** `/api/mutations/stream`
 * SSE (the same source AgentConsole uses) and renders committed graph mutations
 * as an activity trace. No fixtures, no demo data: every row is a real DB write
 * forwarded from the Hono `/mutations/stream` endpoint.
 *
 * This is the thin I/O shell; `AgentActivity` stays a pure projection of its
 * `trace` prop. Field richness is bounded by the live event contract — see
 * `lib/api/activity-adapter.ts`.
 */
export default function AgentActivityLive({ title }: { title?: string }) {
  const [events, setEvents] = useState<RealMutationEvent[]>([]);
  const [phase, setPhase] = useState<ActivityPhase>("loading");
  const esRef = useRef<EventSource | null>(null);
  // event_ids already appended — guards against EventSource auto-reconnect
  // replaying rows we've already shown (the proxy resends from the query cursor).
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const es = new EventSource(`/api/mutations/stream?after=0`);
    esRef.current = es;

    es.addEventListener("graph_mutation", (ev) => {
      const event = JSON.parse((ev as MessageEvent).data) as RealMutationEvent;
      setPhase("ready");
      if (seenRef.current.has(event.event_id)) return; // drop replays
      seenRef.current.add(event.event_id);
      setEvents((prev) => [...prev, event]);
    });

    // EventSource auto-reconnects; once a connection opens we're "ready" even
    // before the first event (empty state), so loading doesn't hang forever.
    es.addEventListener("open", () => setPhase((p) => (p === "loading" ? "ready" : p)));
    es.addEventListener("error", () => {
      // Only surface an error if we never received anything; otherwise the
      // browser is mid-reconnect and existing rows stay visible.
      setPhase((p) => (p === "loading" ? "error" : p));
    });

    return () => es.close();
  }, []);

  const trace: AgentActivityTrace = mutationEventsToActivityTrace(events);
  return <AgentActivity trace={trace} phase={phase} title={title} />;
}
