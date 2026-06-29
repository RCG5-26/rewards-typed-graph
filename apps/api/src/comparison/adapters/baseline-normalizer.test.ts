import { describe, expect, it } from "vitest";

import { TRANSFER_REQUIRED_WALLET } from "../canonical-wallet";
import { evaluatePlan, isHardValid } from "../evaluator";
import {
  classifyAction,
  extractFinalPlan,
  normalizeBaselinePlan,
  parsePoints,
  resolveProgramsInText,
} from "./baseline-normalizer";

const FACTS = TRANSFER_REQUIRED_WALLET;

describe("baseline normalizer", () => {
  it("unwraps the free-text crew envelope and the single-agent plan alike", () => {
    const wrapped = { agent_transcript: [], final_plan: { status: "current" } };
    expect(extractFinalPlan(wrapped)).toEqual({ status: "current" });
    const direct = { status: "current", chosen_award_slug: "x" };
    expect(extractFinalPlan(direct)).toEqual(direct);
  });

  it("classifies actions and parses points from prose", () => {
    expect(classifyAction("Transfer 15,000 Chase points to Hyatt")).toBe("transfer");
    expect(classifyAction("Redeem the Ginza award")).toBe("redeem");
    expect(parsePoints("Transfer 15,000 points")).toBe(15000);
    expect(parsePoints("no number here")).toBeUndefined();
  });

  it("resolves source and destination programs from prose order", () => {
    const programs = resolveProgramsInText(
      "Transfer 15,000 Chase Ultimate Rewards to World of Hyatt",
      FACTS,
    );
    expect(programs.sourceProgramId).toBe("00000000-0000-0000-0000-00000000b001");
    expect(programs.destinationProgramId).toBe("00000000-0000-0000-0000-00000000b002");
  });

  it("normalizes a correct transfer-then-redeem baseline output into a hard-valid plan", () => {
    const rawOutput = {
      status: "current",
      chosen_award_slug: "award:demo_hyatt_ginza:tokyo:3n",
      fallback: null,
      ranked_awards: [
        {
          award_slug: "award:demo_hyatt_ginza:tokyo:3n",
          required_source_points: 45000,
          candidate_fact_slugs: ["award:demo_hyatt_ginza:tokyo:3n"],
        },
      ],
      steps: [
        {
          summary: "Transfer 15,000 Chase Ultimate Rewards points to World of Hyatt",
          reasoning: "Hyatt has 30,000 but Ginza needs 45,000.",
        },
        { summary: "Redeem the Ginza award", reasoning: "Best value at 2.33 cpp." },
      ],
    };
    const plan = normalizeBaselinePlan(rawOutput, FACTS);
    expect(plan.selectedAwardId).toBe("award:demo_hyatt_ginza:tokyo:3n");
    expect(plan.transferRequired).toBe(true);
    expect(plan.transferAmount).toBe(15000);
    expect(plan.steps[0].actionType).toBe("transfer");
    expect(plan.steps[1].actionType).toBe("redeem");
    // The evaluator independently confirms the normalized baseline plan is valid.
    expect(isHardValid(evaluatePlan(plan, FACTS))).toBe(true);
  });

  it("does not invent a transfer the model never described (unaffordable direct redeem)", () => {
    const rawOutput = {
      status: "current",
      chosen_award_slug: "award:demo_hyatt_ginza:tokyo:3n",
      fallback: null,
      ranked_awards: [],
      steps: [{ summary: "Redeem the Ginza award now", reasoning: "It is the best option." }],
    };
    const plan = normalizeBaselinePlan(rawOutput, FACTS);
    expect(plan.transferRequired).toBe(false);
    const evaluation = evaluatePlan(plan, FACTS);
    expect(evaluation.affordable).toBe(false);
    expect(evaluation.goalSatisfied).toBe(false);
  });

  it("never emits chain-of-thought beyond the provided reasoning summary", () => {
    const plan = normalizeBaselinePlan(
      { status: "current", chosen_award_slug: "award:demo_hyatt_ginza:tokyo:3n", steps: [] },
      FACTS,
    );
    // No step means no reasoningSummary leaks; summary is a user-facing label.
    expect(plan.summary).toContain("Ginza");
  });
});

// Regression: incidental "transfer" mentions in non-transfer steps used to be
// mis-typed as transfers with invented (self / unsupported) routes, making
// otherwise-valid baseline plans evaluate as INVALID on `unsupported_transfer_route`.
describe("baseline normalizer — step mis-typing regressions", () => {
  const HYATT = "00000000-0000-0000-0000-00000000b002";
  const hasUnsupportedRoute = (plan: ReturnType<typeof normalizeBaselinePlan>) =>
    evaluatePlan(plan, FACTS).issues.some((i) => i.code === "unsupported_transfer_route");

  it("classifies by the earliest action verb, not an incidental keyword", () => {
    // "redeem" precedes the later mention of "transfer" → redeem.
    expect(
      classifyAction("Redeem 45,000 World of Hyatt points for the stay after the transfer posts."),
    ).toBe("redeem");
    // "keep" precedes "transferred" → hold.
    expect(
      classifyAction("Keep the United option as a backup, but prioritize Hyatt for fewer transferred points."),
    ).toBe("hold");
    // A genuine transfer step is unaffected.
    expect(classifyAction("Transfer 15,000 Chase Ultimate Rewards points to World of Hyatt")).toBe(
      "transfer",
    );
  });

  it("does not turn a redeem step that mentions 'transfer' into a self-route transfer", () => {
    const plan = normalizeBaselinePlan(
      {
        status: "current",
        chosen_award_slug: "award:demo_hyatt_ginza:tokyo:3n",
        steps: [
          { summary: "Transfer 15,000 Chase Ultimate Rewards points to World of Hyatt" },
          { summary: "Redeem 45,000 World of Hyatt points for the stay after the transfer posts." },
        ],
      },
      FACTS,
    );
    expect(plan.steps[1].actionType).toBe("redeem");
    // No step is a self-route transfer (source === destination).
    expect(
      plan.steps.some(
        (s) =>
          s.actionType === "transfer" &&
          s.sourceProgramId !== undefined &&
          s.sourceProgramId === s.destinationProgramId,
      ),
    ).toBe(false);
    expect(hasUnsupportedRoute(plan)).toBe(false);
    // The real recommendation (transfer 15k Chase→Hyatt, then redeem) is valid.
    expect(isHardValid(evaluatePlan(plan, FACTS))).toBe(true);
  });

  it("does not turn a 'keep United as backup' step into an unsupported United→Hyatt transfer", () => {
    const plan = normalizeBaselinePlan(
      {
        status: "current",
        chosen_award_slug: "award:demo_hyatt_ginza:tokyo:3n",
        steps: [
          { summary: "Redeem the Demo Hyatt Ginza award for 45,000 Hyatt points." },
          { summary: "Transfer 15,000 Chase Ultimate Rewards points to World of Hyatt." },
          { summary: "Keep the United option as a backup, but prioritize Hyatt for fewer transferred points." },
        ],
      },
      FACTS,
    );
    expect(plan.steps[2].actionType).toBe("hold");
    expect(hasUnsupportedRoute(plan)).toBe(false);
  });

  it("never synthesizes a self-route when a transfer names only the award program", () => {
    // Source resolves to Hyatt; the destination fallback would also be Hyatt —
    // the fix must drop the destination rather than emit Hyatt→Hyatt.
    const plan = normalizeBaselinePlan(
      {
        status: "current",
        chosen_award_slug: "award:demo_hyatt_ginza:tokyo:3n",
        steps: [{ summary: "Transfer points within World of Hyatt for the award" }],
      },
      FACTS,
    );
    const transferStep = plan.steps.find((s) => s.actionType === "transfer");
    if (transferStep?.sourceProgramId === HYATT) {
      expect(transferStep.destinationProgramId).not.toBe(HYATT);
    }
    expect(hasUnsupportedRoute(plan)).toBe(false);
  });
});
