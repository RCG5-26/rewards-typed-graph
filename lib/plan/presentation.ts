/**
 * Agent + mutation-op identity colors for the console.
 *
 * These are semantic actor colors (per-agent / per-op) that don't exist in the
 * design-system token set, so they live here as a scoped presentation map (same
 * carve-out as the card faces). Ported from the GPFree Onboarding design's
 * `AGENTS` / `OP_COLOR` tables.
 */

import type { AgentType } from "./types";

export interface AgentMeta {
  name: string;
  short: string;
  color: string;
  /** Variant for dark surfaces (the mutation log); falls back to `color`. */
  darkColor?: string;
}

export const AGENT_META: Record<AgentType, AgentMeta> = {
  // near-black reads on the light agent-plan card but vanishes on the dark log,
  // so the log uses the lighter `darkColor`.
  orchestrator: { name: "Orchestrator", short: "ORC", color: "#1C1C22", darkColor: "#c6cede" },
  wallet_agent: { name: "Wallet", short: "WAL", color: "#1f9d8f" },
  earning_agent: { name: "Earning", short: "ERN", color: "#bd8a2e" },
  redemption_agent: { name: "Redemption", short: "RDM", color: "#4f7cf0" },
  system: { name: "Graph", short: "SYS", color: "#8a93a6" },
};

/** Agent identity color for dark surfaces (the mutation log). */
export function agentDarkColor(meta: AgentMeta): string {
  return meta.darkColor ?? meta.color;
}

export const OP_COLOR: Record<string, string> = {
  CREATE: "#1f9d8f",
  READ: "#7c8aa3",
  COMMIT: "#4f7cf0",
  UPDATE: "#bd8a2e",
  STALE: "#ec625c",
  REPLAN: "#4f7cf0",
};

export function opColor(op: string): string {
  return OP_COLOR[op] ?? "#7c8aa3";
}
