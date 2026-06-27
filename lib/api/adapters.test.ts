import { describe, it, expect } from "vitest";
import mockPlan from "@/fixtures/mock-plan.json";
import { toPlanResult, toMutationRows, diffStale, transferParamsFromPersona } from "./adapters";
import { buildTraversalChain } from "@/lib/plan/graph-traversal";
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

  it("maps enriched API dependencies → typed step.dependencies", () => {
    const withDeps = {
      ...rev1,
      steps: rev1.steps.map((step, i) =>
        i === 0
          ? {
              ...step,
              dependencies: [
                {
                  id: "ac721887-48df-4d7c-a7c2-f61bc331b7bc",
                  kind: "reward_programs",
                  table: "reward_programs",
                  slug: "program:hyatt",
                  label: "World of Hyatt",
                  programId: "00000000-0000-0000-0000-00000000b002",
                },
              ],
            }
          : step,
      ),
    } satisfies ApiPlan;

    const first = toPlanResult(withDeps).steps[0];
    expect(first.dependencies).toEqual([
      {
        id: "ac721887-48df-4d7c-a7c2-f61bc331b7bc",
        kind: "reward_programs",
        slug: "program:hyatt",
        label: "World of Hyatt",
      },
    ]);
  });

  it("leaves step.dependencies undefined when the API omits them", () => {
    const first = toPlanResult(rev1).steps[0];
    expect(first.dependencies).toBeUndefined();
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

  it("lights traversal hubs progressively so the plane advances", () => {
    const graph = toPlanResult(rev1).graph;
    const hubIds = buildTraversalChain(graph).map((h) => h.id);
    expect(hubIds.length).toBeGreaterThan(1);

    const rows = toMutationRows(rev1);
    // First row lights the first main-path hub so the plane starts at the origin.
    expect(rows[0].nodeId).toBe(hubIds[0]);

    // Every main-path hub gets lit across the stream (frontier reaches the end).
    const lit = new Set(rows.map((r) => r.nodeId).filter(Boolean));
    for (const id of hubIds) expect(lit.has(id)).toBe(true);

    // Every graph node ends up lit (so "N nodes live" matches what glows).
    for (const node of graph.nodes) expect(lit.has(node.id)).toBe(true);
  });

  it("leaves nodeId unset when the plan has no graph", () => {
    const noGraph = { ...rev1, graph: { nodes: [], edges: [] } };
    const rows = toMutationRows(noGraph);
    expect(rows.every((r) => r.nodeId === undefined)).toBe(true);
  });

  it("emits extra rows so every node lights when nodes exceed the step rows", () => {
    // A single step → only CREATE + COMMIT base rows; six graph nodes is more
    // than steps + 2, the case where the old clamp left the tail nodes dark.
    const manyNodes: ApiPlan = {
      ...rev1,
      steps: [rev1.steps[0]],
      graph: {
        nodes: [
          { id: "program:a", kind: "program", slug: "program:a", label: "A", programId: "00000000-0000-0000-0000-0000000000a1" },
          { id: "program:b", kind: "program", slug: "program:b", label: "B", programId: "00000000-0000-0000-0000-0000000000a2" },
          { id: "award:c", kind: "redemption", slug: "award:c", label: "C", programId: "00000000-0000-0000-0000-0000000000a2" },
          { id: "award:d", kind: "redemption", slug: "award:d", label: "D", programId: "00000000-0000-0000-0000-0000000000a2" },
          { id: "award:e", kind: "redemption", slug: "award:e", label: "E", programId: "00000000-0000-0000-0000-0000000000a2" },
          { id: "award:f", kind: "redemption", slug: "award:f", label: "F", programId: "00000000-0000-0000-0000-0000000000a2" },
        ],
        edges: [
          { id: "t1", from: "program:a", to: "program:b", kind: "transfer" },
          { id: "r1", from: "program:b", to: "award:c", kind: "redeem" },
        ],
      },
    } satisfies ApiPlan;

    // Precondition: more nodes than the base CREATE + COMMIT + UPDATE rows.
    expect(manyNodes.graph!.nodes.length).toBeGreaterThan(manyNodes.steps.length + 2);

    const rows = toMutationRows(manyNodes);
    const lit = new Set(rows.map((r) => r.nodeId).filter(Boolean));
    // Every node lights — none left dark once the rows run out.
    for (const node of manyNodes.graph!.nodes) expect(lit.has(node.id)).toBe(true);
    // Appended rows keep seq monotonic, and the log still closes on the status beat.
    for (let i = 0; i < rows.length; i++) expect(rows[i].seq).toBe(i + 1);
    expect(rows[rows.length - 1].detail).toBe("status -> current");
  });
});

describe("diffStale", () => {
  it("returns staleEdgeId and staleNodeIds for a rev1→rev2 with a dropped transfer step", () => {
    const rev1WithDroppedRedemption: ApiPlan = {
      ...rev1,
      steps: rev1.steps.map((step) =>
        step.type === "transfer_recommendation"
          ? {
              ...step,
              dependsOn: [...step.dependsOn, "00000000-0000-0000-0000-00000000f001"],
            }
          : step,
      ),
    };
    const rev2WithoutDroppedRedemption: ApiPlan = {
      ...rev2,
      steps: rev2.steps.map((step) => ({
        ...step,
        dependsOn: step.dependsOn.filter((id) => id !== "00000000-0000-0000-0000-00000000f001"),
      })),
      graph: {
        nodes: rev2.graph.nodes.filter((node) => node.id !== "award:demo_hyatt_ginza:tokyo:3n"),
        edges: rev2.graph.edges.filter((edge) => edge.to !== "award:demo_hyatt_ginza:tokyo:3n"),
      },
    };

    const result = diffStale(rev1WithDroppedRedemption, rev2WithoutDroppedRedemption);

    expect(result.staleEdgeId).toBeTruthy();
    expect(result.staleNodeIds).toEqual(["award:demo_hyatt_ginza:tokyo:3n"]);
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
