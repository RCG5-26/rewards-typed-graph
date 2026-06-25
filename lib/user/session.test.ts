import { afterEach, describe, expect, it, vi } from "vitest";

import { UnmappedUserError } from "./repository";

const mockGetCurrentUserGraph = vi.fn();

vi.mock("./current", () => ({
  getCurrentUserGraph: () => mockGetCurrentUserGraph(),
}));

describe("resolveSessionGraph", () => {
  afterEach(() => {
    mockGetCurrentUserGraph.mockReset();
  });

  it("returns the graph for a resolved session", async () => {
    const graph = { user: { clerkId: "user_1" } };
    mockGetCurrentUserGraph.mockResolvedValueOnce(graph);
    const { resolveSessionGraph } = await import("./session");

    const result = await resolveSessionGraph();
    expect(result).toEqual({ ok: true, graph });
  });

  it("maps a missing session to 401", async () => {
    mockGetCurrentUserGraph.mockResolvedValueOnce(null);
    const { resolveSessionGraph } = await import("./session");

    const result = await resolveSessionGraph();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      expect(await result.response.json()).toEqual({ error: "Not signed in." });
    }
  });

  it("maps UnmappedUserError to 403", async () => {
    mockGetCurrentUserGraph.mockRejectedValueOnce(new UnmappedUserError());
    const { resolveSessionGraph } = await import("./session");

    const result = await resolveSessionGraph();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(403);
    }
  });

  it("maps an unexpected error to 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetCurrentUserGraph.mockRejectedValueOnce(new Error("db down"));
    const { resolveSessionGraph } = await import("./session");

    const result = await resolveSessionGraph();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(500);
    }
  });
});
