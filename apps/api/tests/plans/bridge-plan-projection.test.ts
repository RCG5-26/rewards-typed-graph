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

// Each case spawns a node subprocess; under full-suite parallel load cold spawns
// can exceed vitest's 5s default (see issue #57).
const SUBPROCESS_TIMEOUT_MS = 30_000;

/** Drive the adapter against the fake bridge instead of the real Python script. */
function buildProjection(overrides: { pythonBin?: string } = {}): BridgePlanProjection {
  return new BridgePlanProjection({
    pythonBin: overrides.pythonBin ?? "node",
    scriptPath: FAKE_BRIDGE,
    env: process.env,
  });
}

describe("BridgePlanProjection (Phase 2 — production PlanProjectionPort over read-plan)", { timeout: SUBPROCESS_TIMEOUT_MS }, () => {
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

  it("rejects a malformed envelope ({ok:true} with no data) instead of masking it as not-found", async () => {
    const projection = buildProjection();

    // A missing `data` key is a protocol bug, not a projection miss. It must
    // surface as an error, never as a silent null/404.
    await expect(projection.project("__NODATA__", USER_ID)).rejects.toThrow(
      /malformed envelope/,
    );
  });

  it("rejects a PlanView whose summary is neither string nor null", async () => {
    const projection = buildProjection();

    await expect(projection.project("__BADSUMMARY__", USER_ID)).rejects.toThrow(/summary/);
  });

  it("throws a PlanProjectionError when the bridge subprocess cannot be spawned", async () => {
    const projection = buildProjection({ pythonBin: "definitely-not-a-real-binary-xyz" });

    await expect(projection.project("plan-123", USER_ID)).rejects.toBeInstanceOf(
      PlanProjectionError,
    );
  });
});
