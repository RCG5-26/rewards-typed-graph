/**
 * Direct tests for the PythonWriteBridge seam (M3).
 *
 * ControlledAgentCommitFactory only mocks this class, so the argv marshalling,
 * env allowlisting, stdout-envelope parsing, and error-code mapping here would
 * otherwise be untested. These drive the real bridge against a fake node script.
 */

import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CommitFailure } from "../contracts";
import type { SpecialistMutation } from "../contracts";
import { PythonWriteBridge } from "./python-write-bridge";

const FAKE_BRIDGE = fileURLToPath(
  new URL("../../../tests/helpers/fake-write-bridge.mjs", import.meta.url),
);

// Each case spawns one or more node subprocesses; under full-suite parallel load
// cold spawns can exceed vitest's 5s default, so give the seam room.
const SUBPROCESS_TIMEOUT_MS = 30_000;

function buildBridge(env?: NodeJS.ProcessEnv): PythonWriteBridge {
  return new PythonWriteBridge({ pythonBin: "node", scriptPath: FAKE_BRIDGE, env });
}

const balanceMutation: SpecialistMutation = {
  kind: "UpdateUserBalance",
  balanceNodeId: "balance-1",
  balancePoints: 1000,
};

function commit(bridge: PythonWriteBridge, idempotencyKey: string, mutation = balanceMutation) {
  return bridge.commitMutation({
    mutation,
    userId: "user-1",
    planId: "plan-1",
    agentRunId: "run-1",
    agentType: "wallet_agent",
    idempotencyKey,
    readSet: { "balance-1": 1 },
  });
}

interface ObservedEnvResult {
  readonly observedEnv: Record<string, string>;
}

describe("PythonWriteBridge env allowlist", () => {
  it("never forwards DATABASE_URL or CLERK_SECRET_KEY to the spawned subprocess", async () => {
    // Assert at the spawn boundary: the fake bridge echoes the env it actually
    // received, so this proves what the child process sees (not an internal field).
    // Locate the interpreter via an absolute path so the deliberately-narrow PATH
    // below is only data the child echoes, not how we resolve `node`.
    const bridge = new PythonWriteBridge({
      pythonBin: process.execPath,
      scriptPath: FAKE_BRIDGE,
      env: {
        PATH: "/usr/bin",
        DATABASE_URL: "pg://host/db",
        CLERK_SECRET_KEY: "not-a-real-clerk-secret",
        PGHOST: "localhost",
      },
    });

    const result = (await commit(bridge, "k1")) as unknown as ObservedEnvResult;
    const observed = result.observedEnv;

    expect(observed["DATABASE_URL"]).toBeUndefined();
    expect(observed["CLERK_SECRET_KEY"]).toBeUndefined();
    expect(observed["PGHOST"]).toBe("localhost");
    expect(observed["PATH"]).toBe("/usr/bin");
  }, SUBPROCESS_TIMEOUT_MS);
});

describe("PythonWriteBridge.commitMutation", () => {
  it("marshals each mutation kind into its own subcommand", async () => {
    const bridge = buildBridge(process.env);

    const balance = await commit(bridge, "k1", balanceMutation);
    expect(balance.mutationTxnId).toBe("txn:orchestrator-record-mutation");

    const step = await commit(bridge, "k2", {
      kind: "CreatePlanStep",
      planId: "plan-1",
      stepOrder: 1,
      stepType: "redemption_recommendation",
      payload: { redemptionOptionId: "f001", sourceProgramId: "b002" },
    });
    expect(step.mutationTxnId).toBe("txn:orchestrator-commit-step");

    const dep = await commit(bridge, "k3", {
      kind: "RecordStateDependency",
      planStepId: "step-1",
      targetNodeId: "balance-1",
      observedVersion: 1,
      target: {
        targetNodeType: "UserBalance",
        targetTable: "user_balances",
        dependedProperty: "balance_points",
        snapshotValue: { balancePoints: 1000 },
      },
    });
    expect(dep.mutationTxnId).toBe("txn:orchestrator-record-dependency");
  }, SUBPROCESS_TIMEOUT_MS);

  it("maps an idempotency_conflict envelope to a CommitFailure(IdempotencyConflict)", async () => {
    const bridge = buildBridge(process.env);

    await expect(commit(bridge, "CONFLICT-1")).rejects.toMatchObject({
      kind: "IdempotencyConflict",
    });
  }, SUBPROCESS_TIMEOUT_MS);

  it("maps a validation envelope to a CommitFailure(ValidationError)", async () => {
    const bridge = buildBridge(process.env);

    await expect(commit(bridge, "VALERR-1")).rejects.toMatchObject({
      kind: "ValidationError",
    });
  }, SUBPROCESS_TIMEOUT_MS);

  it("raises a CommitFailure on non-JSON bridge output", async () => {
    const bridge = buildBridge(process.env);

    await expect(commit(bridge, "NONJSON-1")).rejects.toBeInstanceOf(CommitFailure);
  }, SUBPROCESS_TIMEOUT_MS);

  it("raises a CommitFailure when the interpreter cannot be spawned", async () => {
    const bridge = new PythonWriteBridge({
      pythonBin: "definitely-not-a-real-binary-xyz",
      scriptPath: FAKE_BRIDGE,
      env: process.env,
    });

    await expect(commit(bridge, "k1")).rejects.toBeInstanceOf(CommitFailure);
  }, SUBPROCESS_TIMEOUT_MS);
});
