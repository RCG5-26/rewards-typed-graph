import { describe, expect, it } from "vitest";

import { TRANSFER_REQUIRED_WALLET } from "./canonical-wallet";
import { comparePlans, evaluatePlan, isHardValid, rankPlans } from "./evaluator";
import type { NormalizedPlan } from "./types";

const FACTS = TRANSFER_REQUIRED_WALLET;
const CHASE = "00000000-0000-0000-0000-00000000b001";
const HYATT = "00000000-0000-0000-0000-00000000b002";
const GINZA = "00000000-0000-0000-0000-00000000f001";
const UNITED_PROGRAM = "00000000-0000-0000-0000-00000000b003";
const UNITED_AWARD = "00000000-0000-0000-0000-00000000f002";

/** The canonical winning plan: transfer 15k Chase→Hyatt, then redeem Ginza. */
function transferThenRedeem(): NormalizedPlan {
  return {
    summary: "Transfer 15,000 Chase to Hyatt, then redeem the Ginza award.",
    goalSatisfied: true,
    transferRequired: true,
    transferAmount: 15000,
    selectedProgramId: HYATT,
    selectedAwardId: GINZA,
    redemptionPoints: 45000,
    steps: [
      {
        order: 1,
        actionType: "transfer",
        title: "Transfer 15,000 Chase → Hyatt",
        sourceProgramId: CHASE,
        destinationProgramId: HYATT,
        points: 15000,
      },
      { order: 2, actionType: "redeem", title: "Redeem Ginza", awardId: GINZA, points: 45000 },
    ],
  };
}

describe("deterministic evaluator", () => {
  it("passes the canonical transfer-then-redeem plan", () => {
    const evaluation = evaluatePlan(transferThenRedeem(), FACTS);
    expect(evaluation.structurallyValid).toBe(true);
    expect(evaluation.goalSatisfied).toBe(true);
    expect(evaluation.affordable).toBe(true);
    expect(evaluation.supportedTransferRoute).toBe(true);
    expect(evaluation.allAwardReferencesGrounded).toBe(true);
    expect(evaluation.negativeBalanceCreated).toBe(false);
    expect(evaluation.unnecessaryTransfer).toBe(false);
    expect(evaluation.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(isHardValid(evaluation)).toBe(true);
  });

  it("flags overspend when redeeming Ginza without the required transfer", () => {
    const plan: NormalizedPlan = {
      summary: "Redeem Ginza directly.",
      goalSatisfied: true,
      transferRequired: false,
      selectedProgramId: HYATT,
      selectedAwardId: GINZA,
      redemptionPoints: 45000,
      steps: [{ order: 1, actionType: "redeem", title: "Redeem Ginza", awardId: GINZA, points: 45000 }],
    };
    const evaluation = evaluatePlan(plan, FACTS);
    expect(evaluation.affordable).toBe(false);
    // The plan claims the goal but Hyatt 30k cannot fund Ginza 45k → false claim.
    expect(evaluation.goalSatisfied).toBe(false);
    expect(evaluation.issues.some((i) => i.code === "overspend")).toBe(true);
    expect(evaluation.issues.some((i) => i.code === "goal_falsely_claimed")).toBe(true);
    expect(isHardValid(evaluation)).toBe(false);
  });

  it("flags an award absent from supplied facts as ungrounded", () => {
    const plan = transferThenRedeem();
    plan.selectedAwardId = "award:demo_marriott_tokyo:3n";
    plan.steps[1].awardId = "award:demo_marriott_tokyo:3n";
    const evaluation = evaluatePlan(plan, FACTS);
    expect(evaluation.allAwardReferencesGrounded).toBe(false);
    expect(evaluation.issues.some((i) => i.code === "award_not_grounded")).toBe(true);
    expect(isHardValid(evaluation)).toBe(false);
  });

  it("flags an unsupported transfer route", () => {
    const plan = transferThenRedeem();
    // Hyatt -> United is not a supported route.
    plan.steps[0].sourceProgramId = HYATT;
    plan.steps[0].destinationProgramId = UNITED_PROGRAM;
    const evaluation = evaluatePlan(plan, FACTS);
    expect(evaluation.supportedTransferRoute).toBe(false);
    expect(evaluation.issues.some((i) => i.code === "unsupported_transfer_route")).toBe(true);
  });

  it("flags an unnecessary transfer when the program already covers the award", () => {
    // A facts variant where Hyatt already holds 50k ≥ the 45k Ginza cost, so any
    // transfer into Hyatt before redeeming Ginza is unnecessary.
    const factsHyattRich = structuredClone(FACTS);
    const hyattBalance = factsHyattRich.balances.find((b) => b.programId === HYATT)!;
    hyattBalance.points = 50000;
    const plan: NormalizedPlan = {
      summary: "Unnecessarily transfer then redeem.",
      goalSatisfied: true,
      transferRequired: true,
      transferAmount: 5000,
      selectedProgramId: HYATT,
      selectedAwardId: GINZA,
      redemptionPoints: 45000,
      steps: [
        {
          order: 1,
          actionType: "transfer",
          title: "Transfer 5,000 Chase → Hyatt",
          sourceProgramId: CHASE,
          destinationProgramId: HYATT,
          points: 5000,
        },
        { order: 2, actionType: "redeem", title: "Redeem", awardId: GINZA, points: 45000 },
      ],
    };
    const evaluation = evaluatePlan(plan, factsHyattRich);
    // Hyatt already had 50k which covers the 45k Ginza award — the transfer was unneeded.
    expect(evaluation.unnecessaryTransfer).toBe(true);
    expect(evaluation.issues.some((i) => i.code === "unnecessary_transfer")).toBe(true);
  });

  it("detects a negative balance from over-transferring the source", () => {
    const plan = transferThenRedeem();
    plan.steps[0].points = 999999; // transfer more Chase than the 180k available
    plan.transferAmount = 999999;
    const evaluation = evaluatePlan(plan, FACTS);
    expect(evaluation.negativeBalanceCreated).toBe(true);
    expect(evaluation.issues.some((i) => i.code === "negative_balance")).toBe(true);
  });

  it("ranks a feasible goal-satisfying plan above an infeasible one", () => {
    const good = evaluatePlan(transferThenRedeem(), FACTS);
    const badPlan: NormalizedPlan = {
      summary: "Redeem Ginza directly (infeasible).",
      goalSatisfied: true,
      transferRequired: false,
      selectedProgramId: HYATT,
      selectedAwardId: GINZA,
      redemptionPoints: 45000,
      steps: [{ order: 1, actionType: "redeem", title: "Redeem Ginza", awardId: GINZA, points: 45000 }],
    };
    const bad = evaluatePlan(badPlan, FACTS);
    expect(
      comparePlans(
        { plan: transferThenRedeem(), evaluation: good },
        { plan: badPlan, evaluation: bad },
        FACTS,
      ),
    ).toBeLessThan(0);
  });

  it("ranks higher redemption value first among feasible goal-satisfying plans", () => {
    const ginzaPlan = transferThenRedeem(); // value 23333
    const unitedPlan: NormalizedPlan = {
      summary: "Transfer 30k Chase to United, then redeem the United award.",
      goalSatisfied: true,
      transferRequired: true,
      transferAmount: 30000,
      selectedProgramId: UNITED_PROGRAM,
      selectedAwardId: UNITED_AWARD,
      redemptionPoints: 60000,
      steps: [
        {
          order: 1,
          actionType: "transfer",
          title: "Transfer 30,000 Chase → United",
          sourceProgramId: CHASE,
          destinationProgramId: UNITED_PROGRAM,
          points: 30000,
        },
        { order: 2, actionType: "redeem", title: "Redeem United", awardId: UNITED_AWARD, points: 60000 },
      ],
    };
    const ranked = rankPlans(
      [
        { plan: unitedPlan, evaluation: evaluatePlan(unitedPlan, FACTS) },
        { plan: ginzaPlan, evaluation: evaluatePlan(ginzaPlan, FACTS) },
      ],
      FACTS,
    );
    // Ginza (value 23333) beats United (value 15000).
    expect(ranked[0].plan.selectedAwardId).toBe(GINZA);
  });

  it("grounds award references by slug as well as UUID", () => {
    const plan = transferThenRedeem();
    plan.selectedAwardId = "award:demo_hyatt_ginza:tokyo:3n";
    plan.steps[1].awardId = "award:demo_hyatt_ginza:tokyo:3n";
    const evaluation = evaluatePlan(plan, FACTS);
    expect(evaluation.allAwardReferencesGrounded).toBe(true);
  });
});
