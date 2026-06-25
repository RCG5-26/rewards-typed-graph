import { beforeEach, describe, expect, it, vi } from "vitest";

import mockPlan from "@/fixtures/mock-plan.json";
import { createPlan } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";

vi.mock("@/lib/api/client", () => ({
  createPlan: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ getToken: async () => "test-token" }),
}));

// Import route after mocks are hoisted so it picks up the mocked client
const { POST } = await import("./route");

async function callRoute(body: unknown) {
  const request = new Request("http://localhost/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request);
}

describe("POST /api/plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with a mapped PlanResult for a valid queryText", async () => {
    vi.mocked(createPlan).mockResolvedValue(mockPlan.createPlan as never);

    const res = await callRoute({ queryText: "What's the best way to use my points?" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.planId).toBe(mockPlan.createPlan.planId);
    expect(body.steps).toHaveLength(mockPlan.createPlan.steps.length);
    expect(typeof body.goalType).toBe("string");
  });

  it("returns 400 and skips createPlan when queryText is empty", async () => {
    const res = await callRoute({ queryText: "" });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(vi.mocked(createPlan)).not.toHaveBeenCalled();
  });

  it("returns 400 and skips createPlan when queryText is missing", async () => {
    const res = await callRoute({});

    expect(res.status).toBe(400);
    expect(vi.mocked(createPlan)).not.toHaveBeenCalled();
  });

  it("returns 401 when createPlan throws ApiError not-signed-in", async () => {
    vi.mocked(createPlan).mockRejectedValue(
      new ApiError({ kind: "not-signed-in", status: 401 }),
    );

    const res = await callRoute({ queryText: "best hotel for Tokyo?" });

    expect(res.status).toBe(401);
  });

  it("returns 403 when createPlan throws ApiError unprovisioned", async () => {
    vi.mocked(createPlan).mockRejectedValue(
      new ApiError({ kind: "unprovisioned", status: 403 }),
    );

    const res = await callRoute({ queryText: "best hotel for Tokyo?" });

    expect(res.status).toBe(403);
  });

  it("returns 500 with generic message when createPlan throws an unexpected error", async () => {
    vi.mocked(createPlan).mockRejectedValue(new Error("network timeout"));

    const res = await callRoute({ queryText: "best hotel for Tokyo?" });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Could not build a plan.");
  });
});
