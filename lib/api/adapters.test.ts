import { describe, it, expect } from "vitest";
import mockPlan from "@/fixtures/mock-plan.json";
import { toPlanResult, toMutationRows, diffStale, transferParamsFromPersona } from "./adapters";
import type { ApiPlan, ApiSessionResponse } from "./types";

const rev1: ApiPlan = mockPlan.createPlan as ApiPlan;
const rev2: ApiPlan = mockPlan.balanceTransfer.currentPlan as ApiPlan;

const clonedGraphRev1 = {
  ...rev1,
  steps: rev1.steps.map((step) => ({
    ...step,
    dependsOn: [`clone-${step.order}`],
  })),
  graph: {
    nodes: [
      {
        id: "program:chase_ur",
        kind: "program",
        slug: "program:chase_ur",
        label: "Chase Ultimate Rewards",
        programId: "00000000-0000-0000-0000-00000000b001",
      },
      {
        id: "program:hyatt",
        kind: "program",
        slug: "program:hyatt",
        label: "World of Hyatt",
        programId: "00000000-0000-0000-0000-00000000b002",
      },
      {
        id: "award:demo_hyatt_ginza:tokyo:3n",
        kind: "redemption",
        slug: "award:demo_hyatt_ginza:tokyo:3n",
        label: "Demo Hyatt Ginza",
        programId: "00000000-0000-0000-0000-00000000b002",
      },
    ],
    edges: [
      {
        id: "transfer:chase_ur:hyatt",
        from: "program:chase_ur",
        to: "program:hyatt",
        kind: "transfer",
      },
      {
        id: "redeem:program:hyatt->award:demo_hyatt_ginza:tokyo:3n",
        from: "program:hyatt",
        to: "award:demo_hyatt_ginza:tokyo:3n",
        kind: "redeem",
      },
    ],
  },
} satisfies ApiPlan;

const clonedGraphRev2 = {
  ...clonedGraphRev1,
  planId: "revision-2",
  revisionNumber: 2,
  steps: clonedGraphRev1.steps.filter((step) => step.type !== "transfer_recommendation"),
  graph: {
    nodes: clonedGraphRev1.graph.nodes.filter((node) => node.id !== "program:chase_ur"),
    edges: clonedGraphRev1.graph.edges.filter((edge) => edge.kind !== "transfer"),
  },
} satisfies ApiPlan;

describe("toPlanResult", () => {
  it("maps revisionNumber → revision and preserves planId/lineageId", () => {
    const result = toPlanResult(rev1);
    expect(result.revision).toBe(1);
    expect(result.planId).toBe(rev1.planId);
    expect(result.planLineageId).toBe(rev1.planLineageId);
    expect(result.status).toBe("current");
  });

  it("maps query → queryText and sets a goalType from the query", () => {
    const result = toPlanResult(rev1);
    expect(result.queryText).toBe(rev1.query);
    expect(result.goalType).toBe("specific_redemption");
    expect(result.goalLabel).toBe("specific redemption");
  });

  it("maps step summary → title and dependsOn → deps", () => {
    const result = toPlanResult(rev1);
    expect(result.steps).toHaveLength(rev1.steps.length);
    const first = result.steps[0];
    expect(first.title).toBe(rev1.steps[0].summary);
    expect(first.deps).toEqual(rev1.steps[0].dependsOn);
    expect(first.order).toBe(1);
    expect(first.status).toBe("current");
  });

  it("preserves step reasoning and type", () => {
    const result = toPlanResult(rev1);
    const s2 = result.steps[1];
    expect(s2.type).toBe(rev1.steps[1].type);
    expect(s2.reasoning).toBe(rev1.steps[1].reasoning);
  });

  it("sets revision: 2 on rev2 plan and maps all steps", () => {
    const result = toPlanResult(rev2);
    expect(result.revision).toBe(2);
    expect(result.steps).toHaveLength(rev2.steps.length);
    const s2 = result.steps[1];
    expect(s2.deps).toEqual(rev2.steps[1].dependsOn);
  });

  it("produces a non-empty graph with nodes and edges", () => {
    const result = toPlanResult(rev1);
    expect(result.graph.nodes.length).toBeGreaterThan(0);
    expect(result.liveNodes).toBe(result.graph.nodes.length);
  });

  it("uses API graph metadata instead of template dependency UUIDs", () => {
    const result = toPlanResult(clonedGraphRev1);

    expect(result.steps[0].deps).toEqual(["clone-1"]);
    expect(result.graph.nodes.map((node) => node.id)).toEqual([
      "program:chase_ur",
      "program:hyatt",
      "award:demo_hyatt_ginza:tokyo:3n",
    ]);
    expect(result.graph.edges.map((edge) => edge.id)).toEqual([
      "transfer:chase_ur:hyatt",
      "redeem:program:hyatt->award:demo_hyatt_ginza:tokyo:3n",
    ]);
    expect(result.liveNodes).toBe(3);
  });

  it("includes agentRunIds as an array", () => {
    const result = toPlanResult(rev1);
    expect(Array.isArray(result.agentRunIds)).toBe(true);
  });
});

describe("toMutationRows", () => {
  it("returns a non-empty array of mutation log entries", () => {
    const rows = toMutationRows(rev1);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("each row has required MutationLogEntry fields", () => {
    const rows = toMutationRows(rev1);
    for (const row of rows) {
      expect(typeof row.seq).toBe("number");
      expect(typeof row.op).toBe("string");
      expect(typeof row.node).toBe("string");
      expect(typeof row.detail).toBe("string");
      expect(typeof row.version).toBe("string");
    }
  });

  it("sequence numbers start at 1 and are monotonically increasing", () => {
    const rows = toMutationRows(rev1);
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].seq).toBe(i + 1);
    }
  });
});

describe("diffStale", () => {
  it("returns staleEdgeId and staleNodeIds for a rev1→rev2 with a dropped transfer step", () => {
    const result = diffStale(rev1, rev2);
    expect(result.staleEdgeId).toBeTruthy();
    expect(result.staleNodeIds.length).toBeGreaterThanOrEqual(0);
    expect(result.reason).toBeTruthy();
    expect(result.mutation.op).toBe("STALE");
    expect(result.mutation.agentType).toBe("system");
  });

  it("returns empty staleNodeIds for identical revisions", () => {
    const result = diffStale(rev1, rev1);
    expect(result.staleEdgeId).toBe("");
    expect(result.staleNodeIds).toEqual([]);
  });

  it("detects stale transfer edges from graph metadata with cloned dependency UUIDs", () => {
    const result = diffStale(clonedGraphRev1, clonedGraphRev2);

    expect(result.staleEdgeId).toBe("transfer:chase_ur:hyatt");
    expect(result.mutation.nodeId).toBe("program:chase_ur");
    expect(result.reason).toContain("Chase Ultimate Rewards");
  });
});

describe("transferParamsFromPersona", () => {
  it("returns scripted transfer params for a seeded persona", () => {
    const session: ApiSessionResponse = {
      userId: "00000000-0000-0000-0000-00000000a001",
      clerkId: "user_demo_persona",
      seeded: true,
    };
    const params = transferParamsFromPersona(session);
    expect(params.sourceProgramId).toBeTruthy();
    expect(params.destProgramId).toBeTruthy();
    expect(params.amountPoints).toBeGreaterThan(0);
  });

  it("throws ApiError for a non-seeded session", () => {
    const session: ApiSessionResponse = {
      userId: "some-id",
      clerkId: "user_real",
      seeded: false,
    };
    expect(() => transferParamsFromPersona(session)).toThrow();
  });
});
