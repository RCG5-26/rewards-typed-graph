import "server-only";

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * GET /api/mutations/stream — proxy of the Hono /mutations/stream SSE.
 *
 * Forwards the real graph_mutation events from the Hono API to the browser,
 * injecting the Clerk Bearer token server-side. The browser cannot call Hono
 * directly (BFF architecture, KTD-5). Accepts ?after=<event_id> and forwards
 * it as Last-Event-ID to the upstream, so the client can resume from a cursor.
 *
 * Events match the Hono format exactly:
 *   id: <event_id>
 *   event: graph_mutation
 *   data: <MutationEvent JSON>
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function apiBase(): string {
  const url = process.env.API_BASE_URL;
  if (!url) throw new Error("API_BASE_URL is not set");
  return url.replace(/\/$/, "");
}

export async function GET(request: Request) {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const after = url.searchParams.get("after") ?? "0";

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBase()}/mutations/stream`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Last-Event-ID": after,
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
      signal: request.signal,
    });
  } catch {
    return NextResponse.json({ error: "Upstream stream unavailable." }, { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Upstream stream failed." }, { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
