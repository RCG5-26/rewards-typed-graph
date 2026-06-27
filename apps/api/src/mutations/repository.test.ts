import { describe, expect, it } from "vitest";

import { listMutationEvents } from "./repository";

describe("listMutationEvents", () => {
  it("selects user-scoped graph mutations after the cursor in ascending order", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      async query(sql: string, params: unknown[]) {
        calls.push({ sql, params });
        return {
          rows: [
            {
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
            },
          ],
        };
      },
    };

    const events = await listMutationEvents(client, "00000000-0000-0000-0000-000000000002", 123);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql)
      .toBe(`SELECT id, mutation_txn_id, user_id, plan_lineage_id, plan_id, agent_run_id,
       mutation_type, target_table, target_node_id, summary, before, after,
       committed_at
  FROM graph_mutations
 WHERE user_id = $1
   AND id > $2
 ORDER BY id ASC
 LIMIT $3`);
    expect(calls[0]?.params).toEqual(["00000000-0000-0000-0000-000000000002", 123, 100]);
    expect(events).toEqual([
      expect.objectContaining({
        event_id: "124",
        mutation_type: "TransferPoints",
      }),
    ]);
  });
});
