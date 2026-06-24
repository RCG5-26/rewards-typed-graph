import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type GraphMutationRow } from "./events";
import { createMutationRoutes, type MutationRouteEnv } from "./routes";

const mutationEventSchema = JSON.parse(
  readFileSync(
    new URL("../../../../schema/contracts/mutation-event.schema.json", import.meta.url),
    "utf8",
  ),
);

const eventRow: GraphMutationRow = {
  id: 124,
  mutation_txn_id: "00000000-0000-0000-0000-000000000001",
  user_id: "00000000-0000-0000-0000-000000000002",
  plan_lineage_id: null,
  plan_id: null,
  agent_run_id: null,
  mutation_type: "TransferPoints",
  target_table: "user_balances",
  target_node_id: null,
  summary: "Transferred points",
  before: null,
  after: { version: 2 },
  committed_at: "2026-06-23T12:00:00.000Z",
};

function createTestApp(rows: GraphMutationRow[] = [eventRow]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[]) {
      calls.push({ sql, params });
      return { rows };
    },
  };
  const app = new Hono<MutationRouteEnv>();

  app.use("*", async (c, next) => {
    c.set("userId", "00000000-0000-0000-0000-000000000002");
    await next();
  });
  app.route("/", createMutationRoutes(client, { pollIntervalMs: null }));

  return { app, calls };
}

describe("mutation routes", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns replayed mutation events as JSON", async () => {
    const { app, calls } = createTestApp();

    const response = await app.request("/mutations?after=123");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      expect.objectContaining({
        event_id: "124",
        mutation_type: "TransferPoints",
      }),
    ]);
    expect(calls[0]?.params).toEqual([
      "00000000-0000-0000-0000-000000000002",
      123,
      100,
    ]);
  });

  it.each(["abc", "Infinity", "1.5", String(Number.MAX_SAFE_INTEGER + 1)])(
    "rejects invalid REST mutation cursors before querying: %s",
    async (after) => {
      const { app, calls } = createTestApp();

      const response = await app.request(
        `/mutations?after=${encodeURIComponent(after)}`,
      );

      expect(response.status).toBe(400);
      expect(calls).toHaveLength(0);
    },
  );

  it("streams replayed mutation events as SSE frames", async () => {
    const rows = [
      eventRow,
      {
        ...eventRow,
        id: 125,
        mutation_txn_id: "00000000-0000-0000-0000-000000000003",
        mutation_type: "MarkPlanStale",
        target_table: "plans",
        summary: "Marked plan stale",
        after: { status: "stale" },
      },
    ];
    const { app, calls } = createTestApp(rows);

    const response = await app.request("/mutations/stream", {
      headers: {
        "Last-Event-ID": "123",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const frames = parseSseFrames(await response.text());
    expect(frames.map((frame) => frame.id)).toEqual(["124", "125"]);
    expect(frames.map((frame) => frame.event)).toEqual([
      "graph_mutation",
      "graph_mutation",
    ]);
    expect(calls[0]?.params).toEqual([
      "00000000-0000-0000-0000-000000000002",
      123,
      100,
    ]);
  });

  it("streams mutation events that validate against the JSON Schema contract", async () => {
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(mutationEventSchema);
    const { app } = createTestApp();

    const response = await app.request("/mutations/stream", {
      headers: {
        "Last-Event-ID": "123",
      },
    });

    const [frame] = parseSseFrames(await response.text());

    expect(response.status).toBe(200);
    expect(frame?.event).toBe("graph_mutation");
    expect(validate(frame?.data), JSON.stringify(validate.errors)).toBe(true);
  });

  it.each(["abc", "Infinity", "1.5", String(Number.MAX_SAFE_INTEGER + 1)])(
    "rejects invalid SSE replay cursors before querying: %s",
    async (lastEventId) => {
      const { app, calls } = createTestApp();

      const response = await app.request("/mutations/stream", {
        headers: {
          "Last-Event-ID": lastEventId,
        },
      });

      expect(response.status).toBe(400);
      expect(calls).toHaveLength(0);
    },
  );

  it("does not overlap SSE polling when a previous poll is still pending", async () => {
    vi.useFakeTimers();
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const pendingPoll = createDeferred<{ rows: [] }>();
    const client = {
      async query(sql: string, params: unknown[]) {
        calls.push({ sql, params });
        if (calls.length === 1) {
          return { rows: [] };
        }

        return pendingPoll.promise;
      },
    };
    const app = new Hono<MutationRouteEnv>();
    const abortController = new AbortController();

    app.use("*", async (c, next) => {
      c.set("userId", "00000000-0000-0000-0000-000000000002");
      await next();
    });
    app.route("/", createMutationRoutes(client, { pollIntervalMs: 10 }));

    const response = await app.request("/mutations/stream", {
      signal: abortController.signal,
    });

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(30);
    expect(calls).toHaveLength(2);

    pendingPoll.resolve({ rows: [] });
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toHaveLength(3);

    abortController.abort();
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function parseSseFrames(text: string) {
  return text
    .trim()
    .split("\n\n")
    .filter(Boolean)
    .map((frame) => {
      const lines = frame.split("\n");
      const id = lines.find((line) => line.startsWith("id: "))?.slice(4);
      const event = lines
        .find((line) => line.startsWith("event: "))
        ?.slice(7);
      const dataLine = lines.find((line) => line.startsWith("data: "));
      if (!id || !event || !dataLine) {
        throw new Error(`invalid SSE frame: ${frame}`);
      }

      return {
        id,
        event,
        data: JSON.parse(dataLine.slice(6)) as unknown,
      };
    });
}
