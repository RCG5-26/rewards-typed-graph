/**
 * Contract tests for BridgePlanService (legacy/rollback engine).
 *
 * Tests are grouped into:
 *  - arg marshalling (each public method → correct argv)
 *  - envelope parsing (ok:true → data, ok:false → PlanServiceError or Error)
 *  - env allowlist (CLERK_SECRET_KEY never forwarded)
 *
 * The `execFileAsync` node built-in is stubbed so no Python process is spawned.
 * Tests reference BridgePlanService indirectly through `vi.mock` to intercept
 * the module-level `promisify(execFile)` call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We need to mock before importing BridgePlanService
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({ execFile: mockExecFile }));
vi.mock("node:util", () => ({
  promisify: (fn: unknown) => {
    if (fn === mockExecFile) return mockExecFile;
    // passthrough for other promisify usages
    return (orig: (...args: unknown[]) => unknown) => orig;
  },
}));

// Import AFTER mocks
const { BridgePlanService } = await import("../../src/plans/bridge-service");
const { PlanServiceError } = await import("../../src/plans/service");

function ok<T>(data: T): string {
  return JSON.stringify({ ok: true, data });
}

function fail(code: string, message: string): string {
  return JSON.stringify({ ok: false, error: { code, message } });
}

function makeSvc(env?: NodeJS.ProcessEnv) {
  return new BridgePlanService({
    pythonBin: "python3",
    cwd: "/fake/cwd",
    scriptPath: "/fake/bridge.py",
    env: env ?? { PATH: "/usr/bin", DATABASE_URL: "pg://localhost/test" },
  });
}

describe("BridgePlanService marshalling (legacy/rollback engine)", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("marshals session identity flags", async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: ok({ userId: "u1" }) });

    const svc = makeSvc();
    await svc.getSession({ userId: "u1", clerkId: "clerk1", email: "u@example.com" });

    const [, args] = mockExecFile.mock.calls[0];
    expect(args).toContain("session");
    expect(args).toContain("--user-id");
    expect(args).toContain("u1");
    expect(args).toContain("--clerk-id");
    expect(args).toContain("clerk1");
    expect(args).toContain("--email");
    expect(args).toContain("u@example.com");
  });

  it("marshals demo-reset, get-plan and current-plan reads", async () => {
    const sessionResult = { userId: "u1" };
    const planResult = { planId: "plan-1", steps: [] };

    // resetDemo
    mockExecFile.mockResolvedValueOnce({ stdout: ok(sessionResult) });
    const svc = makeSvc();
    const session = await svc.resetDemo("u1");
    expect(session).toEqual(sessionResult);
    let [, args] = mockExecFile.mock.calls[0];
    expect(args).toContain("demo-reset");
    expect(args).toContain("--user-id");

    mockExecFile.mockReset();

    // getPlanById
    mockExecFile.mockResolvedValueOnce({ stdout: ok(planResult) });
    const plan = await svc.getPlanById("u1", "plan-1");
    expect(plan).toEqual(planResult);
    [, args] = mockExecFile.mock.calls[0];
    expect(args).toContain("get-plan");
    expect(args).toContain("--plan-id");
    expect(args).toContain("plan-1");

    mockExecFile.mockReset();

    // getCurrentPlan
    mockExecFile.mockResolvedValueOnce({ stdout: ok(null) });
    const current = await svc.getCurrentPlan("u1", "lineage-abc");
    expect(current).toBeNull();
    [, args] = mockExecFile.mock.calls[0];
    expect(args).toContain("current-plan");
    expect(args).toContain("--lineage-id");
  });

  it("forwards card slugs as a comma-joined flag", async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: ok({ planId: "p1", steps: [] }) });

    const svc = makeSvc();
    await svc.createPlan("u1", "best Hyatt redemption", [
      "card:chase_sapphire_preferred",
      "card:world_of_hyatt",
    ]);

    const [, args] = mockExecFile.mock.calls[0];
    expect(args).toContain("create-plan");
    expect(args).toContain("--query");
    expect(args).toContain("best Hyatt redemption");
    expect(args).toContain("--card-slugs");
    const idx = args.indexOf("--card-slugs");
    expect(args[idx + 1]).toBe("card:chase_sapphire_preferred,card:world_of_hyatt");
  });

  it("omits --card-slugs when no cards provided", async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: ok({ planId: "p1", steps: [] }) });

    const svc = makeSvc();
    await svc.createPlan("u1", "maximize points");

    const [, args] = mockExecFile.mock.calls[0];
    expect(args).not.toContain("--card-slugs");
  });

  it("marshals balance-transfer args", async () => {
    const transferResult = { newPlan: null, transferredPoints: 45000 };
    mockExecFile.mockResolvedValueOnce({ stdout: ok(transferResult) });

    const svc = makeSvc();
    const result = await svc.transferBalance("u1", {
      sourceProgramId: "b001",
      destProgramId: "b002",
      amountPoints: 45000,
      idempotencyKey: "key-abc",
    });

    expect(result).toEqual(transferResult);
    const [, args] = mockExecFile.mock.calls[0];
    expect(args).toContain("balance-transfer");
    expect(args).toContain("--source-program-id");
    expect(args).toContain("b001");
    expect(args).toContain("--idempotency-key");
    expect(args).toContain("key-abc");
  });

  it("maps a domain error envelope (even on non-zero exit) to a typed PlanServiceError", async () => {
    const errStdout = fail("not_found", "plan not found");
    mockExecFile.mockRejectedValueOnce(
      Object.assign(new Error("exit code 1"), { stdout: errStdout }),
    );

    const svc = makeSvc();
    await expect(svc.createPlan("u1", "query")).rejects.toMatchObject({
      name: "PlanServiceError",
      code: "not_found",
    });
  });

  it("maps an unknown bridge error code to a plain Error", async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: fail("internal_error", "unexpected"),
    });

    const svc = makeSvc();
    await expect(svc.createPlan("u1", "query")).rejects.toThrow(
      /hero bridge error \[internal_error\]/,
    );
  });

  it("throws when bridge stdout is empty on failure", async () => {
    mockExecFile.mockRejectedValueOnce(
      Object.assign(new Error("exit code 1"), { stdout: "" }),
    );

    const svc = makeSvc();
    await expect(svc.createPlan("u1", "query")).rejects.toThrow(/hero bridge failed/);
  });

  it("parses only the final JSON envelope line (ignores debug noise)", async () => {
    const data = { planId: "p-noise", steps: [] };
    // Bridge prints debug noise before the JSON envelope line
    const stdout = `DEBUG: connecting to postgres\nWARN: slow query\n${ok(data)}`;
    mockExecFile.mockResolvedValueOnce({ stdout });

    const svc = makeSvc();
    const result = await svc.getPlanById("u1", "p-noise");
    expect(result).toEqual(data);
  });

  it("never forwards CLERK_SECRET_KEY to the subprocess env", () => {
    const envWithSecret = {
      PATH: "/usr/bin",
      DATABASE_URL: "pg://host/db",
      CLERK_SECRET_KEY: "sk_live_supersecret",
    };
    const svc = makeSvc(envWithSecret);

    // Access private field via any to verify
    const bridgeEnv = (svc as unknown as { env: NodeJS.ProcessEnv }).env;
    expect(bridgeEnv["CLERK_SECRET_KEY"]).toBeUndefined();
    expect(bridgeEnv["PATH"]).toBe("/usr/bin");
    expect(bridgeEnv["DATABASE_URL"]).toBe("pg://host/db");
  });
});
