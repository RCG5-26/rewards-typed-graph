import { describe, expect, it } from "vitest";

import { mutationEventsToActivityTrace } from "./activity-adapter";
import type { RealMutationEvent } from "./types";

/** Minimal real-shaped event (fields the Hono MutationEvent carries). */
function ev(over: Partial<RealMutationEvent> & Pick<RealMutationEvent, "event_id" | "mutation_type">): RealMutationEvent {
  return {
    target_table: null,
    target_node_id: null,
    plan_lineage_id: "lin-1",
    plan_id: "plan-1",
    summary: "",
    ...over,
  };
}

describe("mutationEventsToActivityTrace", () => {
  it("preserves operation order", () => {
    const { entries } = mutationEventsToActivityTrace([
      ev({ event_id: "1", mutation_type: "UpdateUserBalance" }),
      ev({ event_id: "2", mutation_type: "CreatePlanStep" }),
      ev({ event_id: "3", mutation_type: "RecordStateDependency" }),
    ]);
    expect(entries.map((e) => (e.kind === "specialist_run" ? e.operation : e.transition))).toEqual([
      "UpdateUserBalance",
      "CreatePlanStep",
      "RecordStateDependency",
    ]);
  });

  it("infers distinct specialists from mutation_type", () => {
    const { entries } = mutationEventsToActivityTrace([
      ev({ event_id: "1", mutation_type: "UpdateUserBalance" }),
      ev({ event_id: "2", mutation_type: "RecordStateDependency" }),
    ]);
    const specialists = entries.flatMap((e) => (e.kind === "specialist_run" ? [e.specialist] : []));
    expect(specialists).toEqual(["wallet_agent", "redemption_agent"]);
  });

  it("maps lifecycle transitions and infers revision by CreatePlan order", () => {
    const { entries } = mutationEventsToActivityTrace([
      ev({ event_id: "1", mutation_type: "CreatePlan", plan_id: "p1" }),
      ev({ event_id: "2", mutation_type: "MarkStale", plan_id: "p1" }),
      ev({ event_id: "3", mutation_type: "CreatePlan", plan_id: "p2" }),
    ]);
    const lifecycle = entries.filter((e) => e.kind === "plan_lifecycle");
    expect(lifecycle).toEqual([
      expect.objectContaining({ revision: 1, transition: "committed" }),
      expect.objectContaining({ revision: 1, transition: "stale" }),
      expect.objectContaining({ revision: 2, transition: "committed" }),
    ]);
  });

  it("records a commit result only when mutation_txn_id is present", () => {
    const { entries } = mutationEventsToActivityTrace([
      ev({ event_id: "1", mutation_type: "CreatePlanStep", mutation_txn_id: "txn-9" }),
      ev({ event_id: "2", mutation_type: "CreatePlanStep" }),
    ]);
    const runs = entries.filter((e): e is Extract<typeof e, { kind: "specialist_run" }> => e.kind === "specialist_run");
    expect(runs[0].commit).toEqual({ result: "committed", mutationTxnId: "txn-9" });
    expect(runs[1].commit).toBeUndefined();
  });

  it("uses event_id as the row id so repeated agent_run_id values don't collide", () => {
    const { entries } = mutationEventsToActivityTrace([
      ev({ event_id: "e1", mutation_type: "UpdateUserBalance", agent_run_id: "run-7" }),
      ev({ event_id: "e2", mutation_type: "CreatePlanStep", agent_run_id: "run-7" }),
    ]);
    const ids = entries.flatMap((e) => (e.kind === "specialist_run" ? [e.runId] : []));
    expect(ids).toEqual(["e1", "e2"]);
    expect(new Set(ids).size).toBe(ids.length); // unique despite shared agent_run_id
  });

  it("maps committed_at to endedAt on a specialist run", () => {
    const { entries } = mutationEventsToActivityTrace([
      ev({ event_id: "1", mutation_type: "CreatePlanStep", committed_at: "2026-06-27T10:00:00Z" }),
    ]);
    const run = entries[0];
    expect(run.kind).toBe("specialist_run");
    if (run.kind === "specialist_run") {
      expect(run.endedAt).toBe("2026-06-27T10:00:00Z");
    }
  });

  it("never fabricates snapshot or validation fields (backend-gated)", () => {
    const { entries } = mutationEventsToActivityTrace([
      ev({ event_id: "1", mutation_type: "CreatePlanStep", mutation_txn_id: "t" }),
    ]);
    const run = entries[0];
    expect(run.kind).toBe("specialist_run");
    if (run.kind === "specialist_run") {
      expect(run.snapshotVersion).toBeUndefined();
      expect(run.validation).toBeUndefined();
    }
  });

  it("returns an empty trace for no events", () => {
    expect(mutationEventsToActivityTrace([])).toEqual({ planLineageId: "", entries: [] });
  });
});
