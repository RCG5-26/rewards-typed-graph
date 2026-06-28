import { describe, expect, it } from "vitest";

import { TRANSFER_REQUIRED_WALLET } from "./canonical-wallet";
import { deriveCanonicalTransfer } from "./simulate-transfer";

describe("deriveCanonicalTransfer", () => {
  it("derives the 15,000 Chase→Hyatt transfer for the Ginza award gap", () => {
    const transfer = deriveCanonicalTransfer(TRANSFER_REQUIRED_WALLET);
    expect(transfer.sourceProgramId).toBe("00000000-0000-0000-0000-00000000b001");
    expect(transfer.destProgramId).toBe("00000000-0000-0000-0000-00000000b002");
    expect(transfer.amountPoints).toBe(15000);
  });
});
