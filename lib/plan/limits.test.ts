import { describe, expect, it } from "vitest";

import {
  MAX_PLAN_QUERY_LENGTH,
  MAX_SELECTED_CARD_IDS,
  planQueryError,
  selectedCardIdsError,
} from "./limits";

describe("planQueryError", () => {
  it("requires a non-empty goal", () => {
    expect(planQueryError("")).toBe("A goal is required.");
  });

  it("rejects goals over the max length", () => {
    const long = "x".repeat(MAX_PLAN_QUERY_LENGTH + 1);
    expect(planQueryError(long)).toBe(`Goal must be at most ${MAX_PLAN_QUERY_LENGTH} characters.`);
  });

  it("accepts goals at the boundary", () => {
    expect(planQueryError("x".repeat(MAX_PLAN_QUERY_LENGTH))).toBeNull();
  });
});

describe("selectedCardIdsError", () => {
  it("rejects more than the max selected cards", () => {
    const ids = Array.from({ length: MAX_SELECTED_CARD_IDS + 1 }, (_, i) => String(i));
    expect(selectedCardIdsError(ids)).toBe(
      `At most ${MAX_SELECTED_CARD_IDS} cards can be selected.`,
    );
  });

  it("accepts up to the max selected cards", () => {
    const ids = Array.from({ length: MAX_SELECTED_CARD_IDS }, (_, i) => String(i));
    expect(selectedCardIdsError(ids)).toBeNull();
  });
});
