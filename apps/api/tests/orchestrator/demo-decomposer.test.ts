import { describe, expect, it } from "vitest";

import { validateDecomposedQuery } from "../../src/orchestrator/decomposition";
import {
  CHASE_UR_PROGRAM_ID,
  DemoQueryDecomposer,
  HYATT_PROGRAM_ID,
} from "../../src/orchestrator/demo-decomposer";

describe("DemoQueryDecomposer (deterministic frozen-demo decomposition)", () => {
  it("emits exactly the two thesis specialists (wallet + redemption), never earning", async () => {
    const decomposer = new DemoQueryDecomposer();

    const raw = await decomposer.decompose("any query text");
    const decomposed = validateDecomposedQuery(raw);

    const agentTypes = decomposed.invocations.map((i) => i.agentType);
    expect(agentTypes).toEqual(["wallet_agent", "redemption_agent"]);
    expect(agentTypes).not.toContain("earning_agent");
  });

  it("produces a decomposition that passes the frozen validator", async () => {
    const decomposer = new DemoQueryDecomposer();
    const raw = await decomposer.decompose("");
    expect(() => validateDecomposedQuery(raw)).not.toThrow();
  });

  it("targets the seeded Chase UR + Hyatt programs so specialists act on real balances", async () => {
    const decomposer = new DemoQueryDecomposer();
    const decomposed = validateDecomposedQuery(await decomposer.decompose(""));

    const wallet = decomposed.invocations[0];
    const redemption = decomposed.invocations[1];

    expect(wallet.operation).toMatchObject({
      kind: "assess_wallet",
      programIds: [CHASE_UR_PROGRAM_ID, HYATT_PROGRAM_ID],
    });
    expect(redemption.operation).toMatchObject({
      kind: "traverse_redemption",
      goalType: "specific_redemption",
      sourceProgramIds: [CHASE_UR_PROGRAM_ID],
    });
  });

  it("is deterministic — identical output regardless of query text", async () => {
    const decomposer = new DemoQueryDecomposer();
    const a = await decomposer.decompose("query A");
    const b = await decomposer.decompose("a completely different query B");
    expect(a).toEqual(b);
  });
});
