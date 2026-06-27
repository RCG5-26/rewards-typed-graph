import { describe, expect, it } from "vitest";

import { buildBranches, buildTraversalChain } from "./graph-traversal";
import type { PlanGraph } from "./types";

/** Chase → Hyatt, with Hyatt branching to a winner and a backup redemption. */
const branchingGraph: PlanGraph = {
  nodes: [
    { id: "chase", label: "Chase UR", kind: "program", col: 0 },
    { id: "hyatt", label: "World of Hyatt", kind: "program", col: 1 },
    { id: "ginza", label: "Demo Hyatt Ginza", kind: "redemption", col: 2 },
    { id: "shinjuku", label: "Demo Hyatt Shinjuku", kind: "redemption", col: 2 },
  ],
  edges: [
    { id: "t", from: "chase", to: "hyatt", kind: "transfer", state: "active" },
    { id: "r1", from: "hyatt", to: "ginza", kind: "redeem", state: "active" },
    { id: "r2", from: "hyatt", to: "shinjuku", kind: "redeem", state: "active" },
  ],
};

describe("buildTraversalChain", () => {
  it("follows active edges when a stale edge is listed first", () => {
    const graph: PlanGraph = {
      nodes: [
        { id: "ghost", label: "Stale hop", kind: "program", col: 0 },
        { id: "a", label: "Chase UR", kind: "program", col: 0 },
        { id: "b", label: "Hyatt", kind: "program", col: 1 },
        { id: "c", label: "Tokyo award", kind: "redemption", col: 2 },
      ],
      edges: [
        {
          id: "stale-hop",
          from: "ghost",
          to: "a",
          kind: "transfer",
          state: "stale",
        },
        { id: "ab", from: "a", to: "b", kind: "transfer", state: "active" },
        { id: "bc", from: "b", to: "c", kind: "redeem", state: "active" },
      ],
    };

    const hubs = buildTraversalChain(graph);
    expect(hubs.map((h) => h.id)).toEqual(["a", "b", "c"]);
    expect(hubs.map((h) => h.id)).not.toContain("ghost");
  });

  it("ignores superseded edges", () => {
    const graph: PlanGraph = {
      nodes: [
        { id: "a", label: "A", kind: "program", col: 0 },
        { id: "b", label: "B", kind: "program", col: 1 },
      ],
      edges: [
        {
          id: "old",
          from: "a",
          to: "b",
          kind: "transfer",
          state: "superseded",
        },
        { id: "new", from: "a", to: "b", kind: "transfer", state: "active" },
      ],
    };

    const hubs = buildTraversalChain(graph);
    expect(hubs.map((h) => h.id)).toEqual(["a", "b"]);
  });

  it("returns empty when there are no edges", () => {
    expect(buildTraversalChain({ nodes: [], edges: [] })).toEqual([]);
  });

  it("puts the first (winner) redemption on the main path, not the backup", () => {
    const hubs = buildTraversalChain(branchingGraph);
    expect(hubs.map((h) => h.id)).toEqual(["chase", "hyatt", "ginza"]);
    expect(hubs.map((h) => h.kind)).toEqual(["program", "program", "redemption"]);
  });
});

describe("buildBranches", () => {
  it("returns secondary nodes hanging off a main-path hub", () => {
    const mainPath = buildTraversalChain(branchingGraph);
    const branches = buildBranches(branchingGraph, mainPath);
    expect(branches.map((b) => b.id)).toEqual(["shinjuku"]);
    expect(branches[0].parentId).toBe("hyatt");
    expect(branches[0].kind).toBe("redemption");
  });

  it("does not duplicate nodes already on the main path", () => {
    const mainPath = buildTraversalChain(branchingGraph);
    const branches = buildBranches(branchingGraph, mainPath);
    const mainIds = new Set(mainPath.map((h) => h.id));
    for (const b of branches) expect(mainIds.has(b.id)).toBe(false);
  });

  it("returns empty when there are no branches", () => {
    const linear: PlanGraph = {
      nodes: [
        { id: "a", label: "A", kind: "program", col: 0 },
        { id: "b", label: "B", kind: "redemption", col: 1 },
      ],
      edges: [{ id: "ab", from: "a", to: "b", kind: "redeem", state: "active" }],
    };
    expect(buildBranches(linear, buildTraversalChain(linear))).toEqual([]);
  });
});
