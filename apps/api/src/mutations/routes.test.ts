import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createMutationRoutes, type MutationRouteEnv } from "./routes";

const eventRow = {
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

function createTestApp() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    async query(sql: string, params: unknown[]) {
      calls.push({ sql, params });
      return { rows: [eventRow] };
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

  it("streams replayed mutation events as SSE frames", async () => {
    const { app, calls } = createTestApp();

    const response = await app.request("/mutations/stream", {
      headers: {
        "Last-Event-ID": "123",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain(
      `id: 124\nevent: graph_mutation\ndata: {"event_id":"124"`,
    );
    expect(calls[0]?.params).toEqual([
      "00000000-0000-0000-0000-000000000002",
      "123",
      100,
    ]);
  });
});
