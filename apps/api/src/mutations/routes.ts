import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { listMutationEvents, type QueryClient } from "./repository";

type MutationRouteVariables = {
  userId?: string;
};

export type MutationRouteEnv = {
  Variables: MutationRouteVariables;
};

interface MutationRouteOptions {
  pollIntervalMs?: number | null;
}

export function getAuthenticatedUserId(c: Context<MutationRouteEnv>) {
  const userId = c.get("userId");
  if (!userId) {
    throw new HTTPException(401, { message: "authentication required" });
  }
  return userId;
}

export function createMutationRoutes(
  client: QueryClient,
  options: MutationRouteOptions = {},
) {
  const app = new Hono<MutationRouteEnv>();
  const pollIntervalMs =
    options.pollIntervalMs === undefined ? 1000 : options.pollIntervalMs;

  app.get("/mutations", async (c) => {
    const userId = getAuthenticatedUserId(c);
    const after = Number(c.req.query("after") ?? 0);
    const events = await listMutationEvents(client, userId, after);
    return c.json(events);
  });

  app.get("/mutations/stream", (c) => {
    const userId = getAuthenticatedUserId(c);
    let cursor = c.req.header("Last-Event-ID") ?? "0";
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sendAvailableEvents = async () => {
          const events = await listMutationEvents(client, userId, cursor);
          for (const event of events) {
            cursor = event.event_id;
            controller.enqueue(encoder.encode(formatSseEvent(event)));
          }
        };

        await sendAvailableEvents();

        if (pollIntervalMs === null) {
          controller.close();
          return;
        }

        const interval = setInterval(() => {
          void sendAvailableEvents();
        }, pollIntervalMs);
        const abort = () => {
          clearInterval(interval);
          controller.close();
        };

        c.req.raw.signal.addEventListener("abort", abort, { once: true });
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  });

  return app;
}

function formatSseEvent(event: { event_id: string }) {
  return `id: ${event.event_id}\nevent: graph_mutation\ndata: ${JSON.stringify(
    event,
  )}\n\n`;
}
