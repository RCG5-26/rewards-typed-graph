import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BridgePlanProjection,
  PlanProjectionError,
} from "../../src/plans/bridge-plan-projection";

const FAKE_BRIDGE = fileURLToPath(
  new URL("../helpers/fake-projection-bridge.mjs", import.meta.url),
);

const USER_ID = "00000000-0000-0000-0000-00000000a001";

/** Drive the adapter against the fake bridge instead of the real Python script. */
function buildProjection(overrides: { pythonBin?: string } = {}): BridgePlanProjection {
  return new BridgePlanProjection({
    pythonBin: overrides.pythonBin ?? "node",
    scriptPath: FAKE_BRIDGE,
    env: process.env,
  });
}

describe("BridgePlanProjection (Phase 2 — production PlanProjectionPort over read-plan)", () => {
  it("projects a persisted plan into a runtime-validated PlanView", async () => {
    const projection = buildProjection();

    const view = await projection.project("plan-123", USER_ID);

    expect(view).not.toBeNull();
    expect(view?.planId).toBe("plan-123");
    expect(view?.planLineageId).toBe("lineage-plan-123");
    expect(view?.status).toBe("current");
    expect(Array.isArray(view?.steps)).toBe(true);
    expect(view?.graph).toEqual({ nodes: [], edges: [] });
  });

  it("forwards the userId so the projection is user-scoped", async () => {
    const projection = buildProjection();

    const view = await projection.project("plan-123", USER_ID);

    // The fake echoes the forwarded --user-id into `summary`, proving the
    // adapter never reads another user's plan.
    expect(view?.summary).toBe(`user:${USER_ID}`);
  });

  it("returns null when the projection finds no matching plan (caller maps to 404)", async () => {
    const projection = buildProjection();

    const view = await projection.project("__NOTFOUND__", USER_ID);

    expect(view).toBeNull();
  });

  it("throws a PlanProjectionError on a bridge error envelope (no null masking)", async () => {
    const projection = buildProjection();

    await expect(projection.project("__ERROR__", USER_ID)).rejects.toBeInstanceOf(
      PlanProjectionError,
    );
  });

  it("throws a PlanProjectionError on non-JSON bridge output (protocol error)", async () => {
    const projection = buildProjection();

    await expect(projection.project("__NONJSON__", USER_ID)).rejects.toBeInstanceOf(
      PlanProjectionError,
    );
  });

  it("rejects a malformed PlanView rather than passing it through", async () => {
    const projection = buildProjection();

    await expect(projection.project("__MALFORMED__", USER_ID)).rejects.toThrow(
      /PlanView|planLineageId|status|steps|graph/,
    );
  });

  it("throws a PlanProjectionError when the bridge subprocess cannot be spawned", async () => {
    const projection = buildProjection({ pythonBin: "definitely-not-a-real-binary-xyz" });

    await expect(projection.project("plan-123", USER_ID)).rejects.toBeInstanceOf(
      PlanProjectionError,
    );
  });
});
