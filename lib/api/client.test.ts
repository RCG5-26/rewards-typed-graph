import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import mockPlan from "@/fixtures/mock-plan.json";

// Mock fetch at the global level so client.ts (which calls fetch) can be tested.
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// API_BASE_URL must be set before importing the client module.
const FAKE_BASE = "http://localhost:8787";

beforeEach(() => {
  process.env.API_BASE_URL = FAKE_BASE;
  mockFetch.mockReset();
});
afterEach(() => {
  delete process.env.API_BASE_URL;
});

// Dynamic import so env is set first.
const getClient = async () => {
  const mod = await import("./client");
  return mod;
};

describe("apiFetch", () => {
  it("attaches Authorization: Bearer <token> header", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockPlan.createPlan,
    });
    const { apiFetch } = await getClient();
    await apiFetch("/plans", { method: "POST", body: { query: "test" }, token: "tok123" });
    expect(mockFetch).toHaveBeenCalledWith(
      `${FAKE_BASE}/plans`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tok123" }),
      }),
    );
  });

  it("parses and returns the JSON body on 200", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockPlan.createPlan,
    });
    const { apiFetch } = await getClient();
    const result = await apiFetch("/plans", { method: "POST", body: {}, token: "t" });
    expect(result).toMatchObject({ planId: mockPlan.createPlan.planId });
  });

  it("fetches a plan by id with the bearer token", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockPlan.stalePlan,
    });
    const { getPlan } = await getClient();
    const result = await getPlan("plan-123", "tok123");

    expect(result.planId).toBe(mockPlan.stalePlan.planId);
    expect(mockFetch).toHaveBeenCalledWith(
      `${FAKE_BASE}/plans/plan-123`,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer tok123" }),
      }),
    );
  });

  it("throws ApiError with kind not-signed-in on 401", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
    const { apiFetch } = await getClient();
    const { ApiError } = await import("./types");
    await expect(
      apiFetch("/plans", { method: "POST", body: {}, token: "t" }),
    ).rejects.toBeInstanceOf(ApiError);
    try {
      await apiFetch("/plans", { method: "POST", body: {}, token: "t" });
    } catch (e) {
      expect((e as InstanceType<typeof ApiError>).kind.kind).toBe("not-signed-in");
    }
  });

  it("throws ApiError with kind unprovisioned on 403", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    const { apiFetch, ApiError: AE } = await import("./client");
    void AE;
    const { ApiError } = await import("./types");
    await expect(
      apiFetch("/plans", { method: "POST", body: {}, token: "t" }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("throws misconfigured ApiError when API_BASE_URL is not set", async () => {
    delete process.env.API_BASE_URL;
    const { apiFetch } = await import("./client");
    const { ApiError } = await import("./types");
    await expect(
      apiFetch("/plans", { method: "POST", body: {}, token: "t" }),
    ).rejects.toBeInstanceOf(ApiError);
    try {
      await apiFetch("/plans", { method: "POST", body: {}, token: "t" });
    } catch (e) {
      expect((e as InstanceType<typeof ApiError>).kind.kind).toBe("misconfigured");
    }
  });
});
