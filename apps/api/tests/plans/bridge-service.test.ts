import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BridgePlanService } from "../../src/plans/bridge-service";
import { PlanServiceError } from "../../src/plans/service";

const FAKE_BRIDGE = fileURLToPath(new URL("../helpers/fake-bridge.mjs", import.meta.url));

/**
 * Drive BridgePlanService (the python-legacy / rollback engine) against a fake
 * `node` "bridge" instead of hero_bridge.py, so we can prove the TS marshalling,
 * envelope parsing, and typed-error mapping without a real Python/psql process.
 */
function buildService(env?: NodeJS.ProcessEnv): BridgePlanService {
  return new BridgePlanService({ pythonBin: "node", scriptPath: FAKE_BRIDGE, env });
}

type Echo = { command: string; argv: string[] };

describe("BridgePlanService marshalling (legacy/rollback engine)", () => {
  it("marshals create-plan args and parses the final JSON envelope line", async () => {
    const echo = (await buildService().createPlan("user-1", "tokyo trip")) as unknown as Echo;
    expect(echo.command).toBe("create-plan");
    expect(echo.argv).toEqual(["create-plan", "--user-id", "user-1", "--query", "tokyo trip"]);
  });

  it("forwards card slugs as a comma-joined flag", async () => {
    const echo = (await buildService().createPlan("user-1", "q", [
      "csp",
      "amex",
    ])) as unknown as Echo;
    expect(echo.argv).toContain("--card-slugs");
    expect(echo.argv).toContain("csp,amex");
  });

  it("marshals session identity flags", async () => {
    const echo = (await buildService().getSession({
      userId: "user-1",
      clerkId: "clerk_x",
      email: "a@b.co",
    })) as unknown as Echo;
    expect(echo.command).toBe("session");
    expect(echo.argv).toEqual([
      "session",
      "--user-id",
      "user-1",
      "--clerk-id",
      "clerk_x",
      "--email",
      "a@b.co",
    ]);
  });

  it("marshals demo-reset, get-plan and current-plan reads", async () => {
    const reset = (await buildService().resetDemo("user-1")) as unknown as Echo;
    expect(reset.command).toBe("demo-reset");

    const byId = (await buildService().getPlanById("user-1", "plan-9")) as unknown as Echo;
    expect(byId.argv).toEqual(["get-plan", "--user-id", "user-1", "--plan-id", "plan-9"]);

    const current = (await buildService().getCurrentPlan("user-1", "lineage-9")) as unknown as Echo;
    expect(current.argv).toEqual([
      "current-plan",
      "--user-id",
      "user-1",
      "--lineage-id",
      "lineage-9",
    ]);
  });

  it("marshals a balance transfer including the idempotency key", async () => {
    const echo = (await buildService().transferBalance("user-1", {
      sourceProgramId: "b001",
      destProgramId: "b002",
      amountPoints: 30000,
      idempotencyKey: "idem-1",
    })) as unknown as Echo;
    expect(echo.command).toBe("balance-transfer");
    expect(echo.argv).toContain("--amount");
    expect(echo.argv).toContain("30000");
    expect(echo.argv).toContain("--idempotency-key");
    expect(echo.argv).toContain("idem-1");
  });

  it("maps a domain error envelope (even on non-zero exit) to a typed PlanServiceError", async () => {
    await expect(buildService().createPlan("user-1", "__ERROR__")).rejects.toMatchObject({
      name: "PlanServiceError",
      code: "not_found",
    });
    await expect(buildService().createPlan("user-1", "__ERROR__")).rejects.toBeInstanceOf(
      PlanServiceError,
    );
  });

  it("raises a generic error for an unrecognized error code", async () => {
    await expect(buildService().createPlan("user-1", "__UNKNOWNCODE__")).rejects.toThrow(
      /hero bridge error \[weird\]/,
    );
  });

  it("raises when the bridge returns non-JSON output", async () => {
    await expect(buildService().createPlan("user-1", "__NONJSON__")).rejects.toThrow(/non-JSON/);
  });

  it("raises a spawn error when the interpreter cannot be launched", async () => {
    const broken = new BridgePlanService({
      pythonBin: "definitely-not-a-real-binary-xyz",
      scriptPath: FAKE_BRIDGE,
    });
    await expect(broken.createPlan("user-1", "q")).rejects.toThrow(/hero bridge failed/);
  });

  it("never forwards CLERK_SECRET_KEY to the subprocess env", () => {
    const svc = buildService({
      PATH: "/usr/bin",
      DATABASE_URL: "pg://host/db",
      CLERK_SECRET_KEY: "sk_live_supersecret",
    });
    const bridgeEnv = (svc as unknown as { env: NodeJS.ProcessEnv }).env;
    expect(bridgeEnv["CLERK_SECRET_KEY"]).toBeUndefined();
    expect(bridgeEnv["PATH"]).toBe("/usr/bin");
    expect(bridgeEnv["DATABASE_URL"]).toBe("pg://host/db");
  });
});
