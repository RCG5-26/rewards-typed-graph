/**
 * M2 — Minimal conformant EarningAgent stub.
 *
 * earning_agent is excluded from the thesis two-specialist flow (wallet +
 * redemption only). However, AgentRegistry requires all three SpecialistAgentType
 * keys, so a conformant implementation is needed to satisfy the type.
 *
 * If this agent is mistakenly invoked, it throws a clear error so the failure
 * is explicit rather than silent. Per ADR 0010 §5, all specialists are
 * deterministic for this milestone — this stub satisfies the requirement with
 * zero LLM invocations.
 */

import type { Agent, AgentContext } from "../contracts";
import { CommitFailure } from "../contracts";

export class EarningAgent implements Agent<"earning_agent"> {
  readonly agentType = "earning_agent" as const;

  async run(_context: AgentContext<"earning_agent">): Promise<void> {
    throw new CommitFailure(
      "ValidationError",
      "earning_agent is not part of the thesis two-specialist flow; " +
        "invoke only wallet_agent and redemption_agent for this milestone",
    );
  }
}
