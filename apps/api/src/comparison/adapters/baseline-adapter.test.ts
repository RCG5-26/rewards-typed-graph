import { describe, expect, it } from "vitest";

import { TRANSFER_REQUIRED_WALLET } from "../canonical-wallet";
import type { BaselineModule, BaselineReport, RunBaselineReport } from "./baseline-bridge";
import { runChatCrew, runSingleAgent } from "./baseline-adapter";

const FACTS = TRANSFER_REQUIRED_WALLET;
const GINZA_SLUG = "award:demo_hyatt_ginza:tokyo:3n";

function singleAgentReport(): BaselineReport {
  return {
    architecture: "single_agent_llm_baseline",
    cases: [
      {
        case_id: "demo_transfer_required_tokyo",
        token_cost_total: 2050,
        status: "current",
        actual_top_award_slug: GINZA_SLUG,
        baseline_plan_record: {
          raw_output: {
            status: "current",
            chosen_award_slug: GINZA_SLUG,
            fallback: null,
            ranked_awards: [{ award_slug: GINZA_SLUG, required_source_points: 45000 }],
            steps: [
              { summary: "Transfer 15,000 Chase Ultimate Rewards to World of Hyatt", reasoning: "Cover the gap." },
              { summary: "Redeem the Ginza award", reasoning: "Best value." },
            ],
          },
        },
      },
    ],
  };
}

function chatCrewReport(): BaselineReport {
  return {
    architecture: "free_text_multiagent_baseline",
    cases: [
      {
        token_cost_total: 8367,
        status: "current",
        actual_top_award_slug: GINZA_SLUG,
        baseline_plan_record: {
          raw_output: {
            agent_transcript: [{ role: "wallet_agent" }, { role: "redemption_agent" }],
            final_plan: {
              status: "current",
              chosen_award_slug: GINZA_SLUG,
              ranked_awards: [{ award_slug: GINZA_SLUG }],
              steps: [
                { summary: "Transfer 15,000 Chase to Hyatt", reasoning: "Gap." },
                { summary: "Redeem Ginza", reasoning: "Value." },
              ],
            },
          },
        },
      },
    ],
  };
}

const reportFor = (report: BaselineReport): RunBaselineReport => async () => report;

describe("single-agent adapter", () => {
  it("normalizes the report into a succeeded result with one model call", async () => {
    const result = await runSingleAgent({ facts: FACTS, runReport: reportFor(singleAgentReport()) });
    expect(result.variant).toBe("single-agent");
    expect(result.status).toBe("succeeded");
    expect(result.query).toBe(FACTS.query);
    expect(result.plan?.selectedAwardId).toBe(GINZA_SLUG);
    expect(result.plan?.transferAmount).toBe(15000);
    expect(result.metrics.modelCalls).toBe(1);
    expect(result.metrics.totalTokens).toBe(2050);
    expect(result.evidence?.agentTypes).toEqual(["single-agent"]);
    expect(result.evidence?.citedAwardIds).toContain(GINZA_SLUG);
    expect(result.evidence?.availableAwardIds).toContain(GINZA_SLUG);
  });

  it("returns a failed result when the subprocess errors", async () => {
    const failing: RunBaselineReport = async () => {
      throw new Error("OPENAI_API_KEY missing");
    };
    const result = await runSingleAgent({ facts: FACTS, runReport: failing });
    expect(result.status).toBe("failed");
    expect(result.error?.category).toBe("baseline_execution_error");
    expect(result.error?.message).toContain("OPENAI_API_KEY");
  });
});

describe("chat-crew adapter", () => {
  it("normalizes the crew report with four model calls and a handoff count", async () => {
    const result = await runChatCrew({ facts: FACTS, runReport: reportFor(chatCrewReport()) });
    expect(result.variant).toBe("chat-crew");
    expect(result.status).toBe("succeeded");
    expect(result.metrics.modelCalls).toBe(4);
    expect(result.metrics.totalTokens).toBe(8367);
    expect(result.evidence?.handoffCount).toBe(2);
    expect(result.plan?.selectedAwardId).toBe(GINZA_SLUG);
  });
});
