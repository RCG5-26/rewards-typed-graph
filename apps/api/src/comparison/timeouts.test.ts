import { describe, expect, it } from "vitest";

import {
  CHAT_CREW_TIMEOUT_MS,
  GRAPH_TIMEOUT_MS,
  MIN_PROXY_TIMEOUT_MS,
  SINGLE_AGENT_TIMEOUT_MS,
  SLOWEST_ARCHITECTURE_TIMEOUT_MS,
} from "./timeouts";

describe("comparison timeout contract (Fix 4)", () => {
  it("bounds every architecture explicitly", () => {
    expect(GRAPH_TIMEOUT_MS).toBe(60_000);
    expect(SINGLE_AGENT_TIMEOUT_MS).toBe(120_000);
    expect(CHAT_CREW_TIMEOUT_MS).toBe(120_000);
  });

  it("derives the slowest bound from the per-architecture bounds", () => {
    expect(SLOWEST_ARCHITECTURE_TIMEOUT_MS).toBe(
      Math.max(GRAPH_TIMEOUT_MS, SINGLE_AGENT_TIMEOUT_MS, CHAT_CREW_TIMEOUT_MS),
    );
  });

  it("requires the proxy floor to exceed the slowest backend bound (overhead headroom)", () => {
    expect(MIN_PROXY_TIMEOUT_MS).toBeGreaterThan(SLOWEST_ARCHITECTURE_TIMEOUT_MS);
  });
});
