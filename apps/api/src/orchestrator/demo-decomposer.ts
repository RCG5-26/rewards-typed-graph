import type { Decomposer, DecomposedQuery } from "./contracts";

/**
 * Frozen demo program identifiers (demo-seed-v1). These match the IDs the
 * production specialists key on (`redemption-agent.ts`) and the seeded
 * `user_balances.program_id` rows, so the decomposed invocations act on real
 * balances rather than placeholder slugs.
 */
export const CHASE_UR_PROGRAM_ID = "00000000-0000-0000-0000-00000000b001";
export const HYATT_PROGRAM_ID = "00000000-0000-0000-0000-00000000b002";
export const HYATT_REDEMPTION_OPTION_ID = "00000000-0000-0000-0000-00000000f001";

/**
 * Deterministic `Decomposer` for the frozen thesis demo (ADR 0010 §5 —
 * specialists remain deterministic for this milestone; Wallet + Redemption are
 * the two thesis specialists).
 *
 * It ignores the query text and always emits the same two-invocation plan:
 *   1. wallet_agent — assess the Chase UR + Hyatt balances.
 *   2. redemption_agent — traverse toward the Hyatt award (specific_redemption),
 *      funded from Chase UR.
 *
 * `earning_agent` is intentionally absent: it is excluded from the two-specialist
 * flow and its adapter fails loudly if ever invoked (so an unexpected earning
 * run surfaces rather than passing silently).
 */
export class DemoQueryDecomposer implements Decomposer {
  async decompose(_queryText: string): Promise<DecomposedQuery> {
    return {
      invocations: [
        {
          agentType: "wallet_agent",
          operation: {
            kind: "assess_wallet",
            agentType: "wallet_agent",
            programIds: [CHASE_UR_PROGRAM_ID, HYATT_PROGRAM_ID],
          },
        },
        {
          agentType: "redemption_agent",
          operation: {
            kind: "traverse_redemption",
            agentType: "redemption_agent",
            goalType: "specific_redemption",
            targetRedemptionOptionId: HYATT_REDEMPTION_OPTION_ID,
            sourceProgramIds: [CHASE_UR_PROGRAM_ID],
          },
        },
      ],
    };
  }
}
