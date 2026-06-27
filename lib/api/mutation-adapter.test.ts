/**
 * Tests for fromMutationEvent — maps a Hono RealMutationEvent into the
 * frontend MutationLogEntry the dark mutation log renders.
 */
import { describe, expect, it } from "vitest";

import { fromMutationEvent } from "./mutation-adapter";
import type { RealMutationEvent } from "./types";

function event(overrides: Partial<RealMutationEvent> = {}): RealMutationEvent {
  return {
    event_id: "1",
    mutation_type: "CreatePlanStep",
    target_table: "plan_steps",
    target_node_id: "abcd1234-0000-0000-0000-000000000000",
    plan_lineage_id: "lineage-1",
    plan_id: "plan-1",
    summary: "Created redemption step",
    ...overrides,
  };
}

describe("fromMutationEvent", () => {
  it("translates mutation_type into the matching agent and op", () => {
    const entry = fromMutationEvent(event({ mutation_type: "CreatePlan" }), 0);
    expect(entry.agentType).toBe("orchestrator");
    expect(entry.op).toBe("CREATE");

    const stepEntry = fromMutationEvent(event({ mutation_type: "CreatePlanStep" }), 1);
    expect(stepEntry.agentType).toBe("redemption_agent");
    expect(stepEntry.op).toBe("COMMIT");
  });

  it("copies summary into detail and carries the sequence number", () => {
    const entry = fromMutationEvent(event({ summary: "wrote dependency" }), 7);
    expect(entry.detail).toBe("wrote dependency");
    expect(entry.seq).toBe(7);
    expect(entry.version).toBe("v1");
  });

  it("builds node from target_table + first 8 chars of the node id", () => {
    const entry = fromMutationEvent(event(), 0);
    expect(entry.node).toBe("plan_steps:abcd1234");
    expect(entry.nodeId).toBe("abcd1234-0000-0000-0000-000000000000");
  });

  it("falls back to mutation_type for node when target_table is absent", () => {
    const entry = fromMutationEvent(
      event({ target_table: null, target_node_id: null, mutation_type: "MarkStale" }),
      0,
    );
    expect(entry.node).toBe("MarkStale");
  });

  it("normalizes a missing target_node_id to undefined", () => {
    const entry = fromMutationEvent(event({ target_node_id: null }), 0);
    expect(entry.nodeId).toBeUndefined();
    // node still builds from target_table with an empty id slice
    expect(entry.node).toBe("plan_steps:");
  });
});
