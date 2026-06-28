/**
 * Contract test for EarningAgent (M2).
 *
 * earning_agent is excluded from the thesis two-specialist flow, so its only
 * behavior is to fail loudly if invoked. This test locks in that contract: an
 * accidental dispatch must throw a ValidationError, never silently succeed.
 */

import { describe, expect, it, vi } from "vitest";

import type { AgentContext } from "../contracts";
import { CommitFailure } from "../contracts";
import { EarningAgent } from "./earning-agent";

function makeContext(): AgentContext<"earning_agent"> {
  return {
    planId: "plan-1",
    userId: "user-1",
    agentRunId: "run-1",
    operation: {
      kind: "recommend_earning",
      agentType: "earning_agent",
      spendCategoryIds: ["cat-1"],
    },
    snapshot: { userBalances: [], userGoals: [], userProgramStatuses: [] },
    commit: vi.fn(),
  };
}

describe("EarningAgent", () => {
  it("throws a ValidationError when invoked (not part of the thesis flow)", async () => {
    const agent = new EarningAgent();

    await expect(agent.run(makeContext())).rejects.toMatchObject({
      kind: "ValidationError",
    });
  });

  it("never commits a mutation", async () => {
    const agent = new EarningAgent();
    const ctx = makeContext();

    await expect(agent.run(ctx)).rejects.toBeInstanceOf(CommitFailure);
    expect(ctx.commit).not.toHaveBeenCalled();
  });
});
