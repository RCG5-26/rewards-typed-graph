import { describe, it, expect } from "vitest";
import { agentDarkColor, type AgentMeta } from "./presentation";

const base: AgentMeta = { name: "Test", short: "TST", color: "#111111" };

describe("agentDarkColor", () => {
  it("returns the dark-surface variant when present", () => {
    expect(agentDarkColor({ ...base, darkColor: "#c6cede" })).toBe("#c6cede");
  });

  it("falls back to the base color when no dark variant is set", () => {
    expect(agentDarkColor(base)).toBe("#111111");
  });
});
