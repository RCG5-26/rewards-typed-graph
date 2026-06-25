import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

import { toMutationEvent } from "./events";

const mutationEventSchema = JSON.parse(
  readFileSync(
    new URL("../../../../schema/contracts/mutation-event.schema.json", import.meta.url),
    "utf8",
  ),
);

describe("toMutationEvent", () => {
  it("maps graph_mutations rows to the mutation event contract", () => {
    const event = toMutationEvent({
      id: 123n,
      mutation_txn_id: "00000000-0000-0000-0000-000000000001",
      user_id: "00000000-0000-0000-0000-000000000002",
      plan_lineage_id: "00000000-0000-0000-0000-000000000003",
      plan_id: "00000000-0000-0000-0000-000000000004",
      agent_run_id: "00000000-0000-0000-0000-000000000005",
      mutation_type: "TransferPoints",
      target_table: "user_balances",
      target_node_id: "00000000-0000-0000-0000-000000000006",
      summary: "Transferred points from source balance",
      before: { balance_points: 60000, version: 1 },
      after: { balance_points: 50000, version: 2 },
      committed_at: new Date("2026-06-23T12:00:00.000Z"),
    });

    expect(event).toEqual({
      event_id: "123",
      mutation_txn_id: "00000000-0000-0000-0000-000000000001",
      user_id: "00000000-0000-0000-0000-000000000002",
      plan_lineage_id: "00000000-0000-0000-0000-000000000003",
      plan_id: "00000000-0000-0000-0000-000000000004",
      agent_run_id: "00000000-0000-0000-0000-000000000005",
      mutation_type: "TransferPoints",
      target_table: "user_balances",
      target_node_id: "00000000-0000-0000-0000-000000000006",
      summary: "Transferred points from source balance",
      before: { balance_points: 60000, version: 1 },
      after: { balance_points: 50000, version: 2 },
      committed_at: "2026-06-23T12:00:00.000Z",
    });
  });

  it("stringifies numeric event ids without renaming DDL fields", () => {
    const event = toMutationEvent({
      id: "456",
      mutation_txn_id: "00000000-0000-0000-0000-000000000001",
      user_id: "00000000-0000-0000-0000-000000000002",
      plan_lineage_id: null,
      plan_id: null,
      agent_run_id: null,
      mutation_type: "MarkStale",
      target_table: null,
      target_node_id: null,
      summary: "Marked plan stale",
      before: null,
      after: { status: "stale" },
      committed_at: "2026-06-23T12:00:00.000Z",
    });

    expect(event.event_id).toBe("456");
    expect(event).toHaveProperty("mutation_txn_id");
    expect(event).toHaveProperty("target_node_id");
    expect(event).not.toHaveProperty("id");
  });

  it("rejects unsafe numeric event ids before stringifying them", () => {
    expect(() =>
      toMutationEvent({
        id: Number.MAX_SAFE_INTEGER + 1,
        mutation_txn_id: "00000000-0000-0000-0000-000000000001",
        user_id: "00000000-0000-0000-0000-000000000002",
        plan_lineage_id: null,
        plan_id: null,
        agent_run_id: null,
        mutation_type: "MarkStale",
        target_table: null,
        target_node_id: null,
        summary: "Marked plan stale",
        before: null,
        after: { status: "stale" },
        committed_at: "2026-06-23T12:00:00.000Z",
      }),
    ).toThrow("event_id number is outside the safe integer range");
  });

  it("produces events that validate against the mutation event JSON Schema", () => {
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(mutationEventSchema);

    const event = toMutationEvent({
      id: 789,
      mutation_txn_id: "00000000-0000-0000-0000-000000000001",
      user_id: "00000000-0000-0000-0000-000000000002",
      plan_lineage_id: null,
      plan_id: null,
      agent_run_id: null,
      mutation_type: "MarkStale",
      target_table: "plans",
      target_node_id: "00000000-0000-0000-0000-000000000006",
      summary: "Marked plan stale",
      before: null,
      after: { status: "stale" },
      committed_at: new Date("2026-06-23T12:00:00.000Z"),
    });

    expect(validate(event), JSON.stringify(validate.errors)).toBe(true);
  });
});
