import { describe, expect, it } from "vitest";

import { buildTraversalChain } from "./graph-traversal";
import type { PlanGraph } from "./types";

describe("buildTraversalChain", () => {
  it("follows active edges when a stale edge is listed first", () => {
    const graph: PlanGraph = {
      nodes: [
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
});
