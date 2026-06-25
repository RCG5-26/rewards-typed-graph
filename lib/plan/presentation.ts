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
}

export const AGENT_META: Record<AgentType, AgentMeta> = {
  orchestrator: { name: "Orchestrator", short: "ORC", color: "#1C1C22" },
  wallet_agent: { name: "Wallet", short: "WAL", color: "#1f9d8f" },
  earning_agent: { name: "Earning", short: "ERN", color: "#bd8a2e" },
  redemption_agent: { name: "Redemption", short: "RDM", color: "#4f7cf0" },
  system: { name: "Graph", short: "SYS", color: "#8a93a6" },
};

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
