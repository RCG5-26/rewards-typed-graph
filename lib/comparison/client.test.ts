import { describe, expect, it } from "vitest";

import { COMPARISON_PROXY_TIMEOUT_MS } from "./client";

/**
 * The proxy must allow at least the slowest backend architecture bound plus
 * response overhead (review Fix 4). The backend bounds live in
 * `apps/api/src/comparison/timeouts.ts` (graph 60s, single/chat 120s); the repo
 * has no shared TS workspace (ADR 0007), so the floor is mirrored here.
 */
const SLOWEST_BACKEND_MS = 120_000;
const FLOOR_MS = SLOWEST_BACKEND_MS + 15_000;

describe("comparison proxy timeout (Fix 4)", () => {
  it("sits at or above the slowest backend bound plus overhead", () => {
    expect(COMPARISON_PROXY_TIMEOUT_MS).toBeGreaterThanOrEqual(FLOOR_MS);
  });

  it("is the documented 135s value", () => {
    expect(COMPARISON_PROXY_TIMEOUT_MS).toBe(135_000);
  });
});
