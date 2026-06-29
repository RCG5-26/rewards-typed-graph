import { describe, expect, it } from "vitest";

import { TRANSFER_REQUIRED_WALLET } from "./canonical-wallet";
import {
  applyTransferToFacts,
  buildGraphResult,
  deriveCanonicalTransfer,
} from "./simulate-transfer";
import type { PlanView } from "../plans/types";

const HYATT_PROGRAM_ID = "00000000-0000-0000-0000-00000000b002";
const HYATT_AWARD_ID = "00000000-0000-0000-0000-00000000f001";

/** rev2 after the transfer completes: a direct redemption with no transfer step. */
function directRedemptionView(): PlanView {
  return {
    planId: "plan-2",
    planLineageId: "lineage-1",
    revisionNumber: 2,
    status: "current",
    query: TRANSFER_REQUIRED_WALLET.query,
    summary: null,
    steps: [
      {
        order: 1,
        type: "redemption_recommendation",
        summary: "Book Demo Hyatt Ginza 3-night Tokyo award for 45,000 Hyatt points.",
        reasoning: "Hyatt now meets the minimum.",
        status: "current",
        dependsOn: [],
        dependencies: [],
      },
    ],
    graph: {
      nodes: [
        { id: HYATT_PROGRAM_ID, kind: "program", slug: "program:hyatt", label: "World of Hyatt", programId: HYATT_PROGRAM_ID },
        { id: HYATT_AWARD_ID, kind: "redemption", slug: HYATT_AWARD_ID, label: "Demo Hyatt Ginza 3-night Tokyo award", programId: HYATT_PROGRAM_ID },
      ],
      edges: [{ id: "redeem-1", from: "program:hyatt", to: HYATT_AWARD_ID, kind: "redeem" }],
    },
  };
}

describe("deriveCanonicalTransfer", () => {
  it("derives the 15,000 Chase→Hyatt transfer for the Ginza award gap", () => {
    const transfer = deriveCanonicalTransfer(TRANSFER_REQUIRED_WALLET);
    expect(transfer.sourceProgramId).toBe("00000000-0000-0000-0000-00000000b001");
    expect(transfer.destProgramId).toBe("00000000-0000-0000-0000-00000000b002");
    expect(transfer.amountPoints).toBe(15000);
  });
});

describe("applyTransferToFacts", () => {
  it("debits the source and credits the destination without mutating the input", () => {
    const transfer = deriveCanonicalTransfer(TRANSFER_REQUIRED_WALLET);
    const post = applyTransferToFacts(TRANSFER_REQUIRED_WALLET, transfer);

    const hyatt = post.balances.find((b) => b.programId === HYATT_PROGRAM_ID);
    expect(hyatt?.points).toBe(45000); // 30,000 + 15,000

    const originalHyatt = TRANSFER_REQUIRED_WALLET.balances.find((b) => b.programId === HYATT_PROGRAM_ID);
    expect(originalHyatt?.points).toBe(30000); // input untouched
  });
});

describe("buildGraphResult (post-transfer rev2)", () => {
  it("marks the direct-redemption plan goal-satisfied against post-transfer balances", () => {
    const transfer = deriveCanonicalTransfer(TRANSFER_REQUIRED_WALLET);
    const postTransferFacts = applyTransferToFacts(TRANSFER_REQUIRED_WALLET, transfer);

    const result = buildGraphResult(postTransferFacts, directRedemptionView(), false);

    expect(result.plan.selectedAwardId).toBe("award:demo_hyatt_ginza:tokyo:3n");
    expect(result.plan.transferRequired).toBe(false);
    expect(result.evaluation?.affordable).toBe(true);
    expect(result.evaluation?.goalSatisfied).toBe(true);
  });
});
