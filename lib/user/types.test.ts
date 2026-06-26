import { describe, expect, it } from "vitest";

import { isUserGraph } from "./types";

describe("isUserGraph", () => {
  const graph = {
    user: {
      id: "u1",
      clerkId: "ck1",
      email: null,
      displayName: "Alex",
      imageUrl: null,
      isDemoPersona: true,
    },
    balances: [
      {
        programId: "p1",
        programName: "Chase UR",
        currencyName: "points",
        balancePoints: 120_000,
      },
    ],
    goals: [],
    holds: [],
  };

  it("accepts a full UserGraph", () => {
    expect(isUserGraph(graph)).toBe(true);
  });

  it("rejects identity-only session payloads", () => {
    expect(isUserGraph({ userId: "u1", clerkId: "ck1", seeded: true })).toBe(false);
  });

  it.each([null, undefined, "graph", 42, true])(
    "rejects non-object value %p",
    (value) => {
      expect(isUserGraph(value)).toBe(false);
    },
  );

  it("rejects graphs missing balances", () => {
    expect(isUserGraph({ ...graph, balances: undefined })).toBe(false);
  });

  it("rejects graphs missing goals or holds", () => {
    expect(isUserGraph({ ...graph, goals: undefined })).toBe(false);
    expect(isUserGraph({ ...graph, holds: undefined })).toBe(false);
  });

  it("rejects a missing or malformed user", () => {
    expect(isUserGraph({ ...graph, user: undefined })).toBe(false);
    expect(isUserGraph({ ...graph, user: {} })).toBe(false);
    expect(isUserGraph({ ...graph, user: { id: "u1" } })).toBe(false);
  });

  it("rejects balances with malformed elements", () => {
    expect(isUserGraph({ ...graph, balances: [null] })).toBe(false);
    expect(
      isUserGraph({ ...graph, balances: [{ programName: "Chase UR" }] }),
    ).toBe(false);
    expect(
      isUserGraph({ ...graph, balances: [{ balancePoints: 100 }] }),
    ).toBe(false);
  });
});
