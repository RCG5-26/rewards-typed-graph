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
    const after = parseMutationCursor(c.req.query("after"));
    const events = await listMutationEvents(client, userId, after);
    return c.json(events);
  });

  app.get("/mutations/stream", (c) => {
    const userId = getAuthenticatedUserId(c);
    let cursor = parseMutationCursor(c.req.header("Last-Event-ID"));
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

        try {
          await sendAvailableEvents();
        } catch (error) {
          controller.error(error);
          return;
        }

        if (pollIntervalMs === null) {
          controller.close();
          return;
        }

        let isPolling = false;
        let isClosed = false;
        let interval: ReturnType<typeof setInterval>;
        const poll = async () => {
          if (isPolling || isClosed) {
            return;
          }

          isPolling = true;
          try {
            await sendAvailableEvents();
          } catch (error) {
            isClosed = true;
            clearInterval(interval);
            controller.error(error);
          } finally {
            isPolling = false;
          }
        };

        interval = setInterval(() => {
          void poll();
        }, pollIntervalMs);
        const abort = () => {
          isClosed = true;
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

function parseMutationCursor(rawCursor: string | undefined) {
  const cursor = rawCursor ?? "0";

  if (!/^[0-9]+$/.test(cursor)) {
    throw new HTTPException(400, { message: "invalid mutation cursor" });
  }

  return cursor;
}

function formatSseEvent(event: { event_id: string }) {
  return `id: ${event.event_id}\nevent: graph_mutation\ndata: ${JSON.stringify(
    event,
  )}\n\n`;
}
