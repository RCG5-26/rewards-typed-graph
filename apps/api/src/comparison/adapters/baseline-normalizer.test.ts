import { describe, expect, it } from "vitest";

import { TRANSFER_REQUIRED_WALLET } from "../canonical-wallet";
import { evaluatePlan, isHardValid } from "../evaluator";
import { extractFinalPlan, normalizeBaselinePlan, requiredTransfer } from "./baseline-normalizer";

const FACTS = TRANSFER_REQUIRED_WALLET;
const CHASE = "00000000-0000-0000-0000-00000000b001";
const HYATT = "00000000-0000-0000-0000-00000000b002";
const GINZA = "award:demo_hyatt_ginza:tokyo:3n";
const ginzaAward = FACTS.awardOptions.find((a) => a.awardSlug === GINZA)!;

const hasUnsupportedRoute = (plan: ReturnType<typeof normalizeBaselinePlan>) =>
  evaluatePlan(plan, FACTS).issues.some((i) => i.code === "unsupported_transfer_route");

describe("baseline normalizer", () => {
  it("unwraps the free-text crew envelope and the single-agent plan alike", () => {
    const wrapped = { agent_transcript: [], final_plan: { status: "current" } };
    expect(extractFinalPlan(wrapped)).toEqual({ status: "current" });
    const direct = { status: "current", chosen_award_slug: "x" };
    expect(extractFinalPlan(direct)).toEqual(direct);
  });

  it("derives transfer→redeem from the structured award choice and is hard-valid", () => {
    const plan = normalizeBaselinePlan(
      {
        status: "current",
        chosen_award_slug: GINZA,
        steps: [{ summary: "Transfer 15,000 Chase to World of Hyatt" }, { summary: "Redeem Ginza" }],
      },
      FACTS,
    );
    expect(plan.selectedAwardId).toBe(GINZA);
    expect(plan.transferRequired).toBe(true);
    expect(plan.transferAmount).toBe(15000);
    expect(plan.steps[0]).toMatchObject({
      actionType: "transfer",
      sourceProgramId: CHASE,
      destinationProgramId: HYATT,
      points: 15000,
    });
    expect(plan.steps[1].actionType).toBe("redeem");
    expect(isHardValid(evaluatePlan(plan, FACTS))).toBe(true);
  });

  it("ignores ambiguous prose entirely — no parsed transfer can corrupt the plan", () => {
    // The exact prose that previously mis-typed as United→Hyatt / Hyatt→Chase.
    const plan = normalizeBaselinePlan(
      {
        status: "current",
        chosen_award_slug: GINZA,
        steps: [
          { summary: "Choose the Demo Hyatt Ginza award for three nights in Tokyo." },
          { summary: "Use your existing Hyatt balance and transfer the shortfall from Chase Ultimate Rewards." },
          { summary: "Use the United option only as a backup, since it requires more transferred points." },
        ],
      },
      FACTS,
    );
    // The only transfer is the deterministic, supported Chase→Hyatt one.
    const transfers = plan.steps.filter((s) => s.actionType === "transfer");
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ sourceProgramId: CHASE, destinationProgramId: HYATT });
    expect(hasUnsupportedRoute(plan)).toBe(false);
    expect(isHardValid(evaluatePlan(plan, FACTS))).toBe(true);
  });

  it("does not claim goal satisfied or a transfer when no award was chosen", () => {
    const plan = normalizeBaselinePlan({ status: "current", fallback: "cash" }, FACTS);
    expect(plan.goalSatisfied).toBe(false);
    expect(plan.transferRequired).toBe(false);
    expect(plan.steps).toHaveLength(0);
  });

  it("never emits chain-of-thought beyond the structured fields", () => {
    const plan = normalizeBaselinePlan({ status: "current", chosen_award_slug: GINZA, steps: [] }, FACTS);
    expect(plan.summary).toContain("Ginza");
    // Steps are derived; none carries free-text reasoning.
    expect(plan.steps.every((s) => s.reasoningSummary === undefined)).toBe(true);
  });
});

describe("requiredTransfer (deterministic deficit math)", () => {
  it("returns the supported source transfer that closes the deficit", () => {
    expect(requiredTransfer(ginzaAward, FACTS)).toEqual({
      sourceProgramId: CHASE,
      destinationProgramId: HYATT,
      points: 15000, // Hyatt 30k → needs 45k → 15k at 1:1 from Chase
    });
  });

  it("returns null when the destination program already covers the award", () => {
    const cheapHyattAward = { ...ginzaAward, pointsRequired: 25000 }; // Hyatt has 30k
    expect(requiredTransfer(cheapHyattAward, FACTS)).toBeNull();
  });

  it("returns null when no supported route has enough source balance", () => {
    const hugeAward = { ...ginzaAward, pointsRequired: 5_000_000 }; // Chase can't cover the deficit
    expect(requiredTransfer(hugeAward, FACTS)).toBeNull();
  });
});
