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
  delete process.env.API_FETCH_TIMEOUT_MS;
  vi.useRealTimers();
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

  it("throws server-error ApiError for non-auth upstream failures", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    const { apiFetch } = await getClient();
    const { ApiError } = await import("./types");

    await expect(
      apiFetch("/plans", { method: "POST", body: {}, token: "t" }),
    ).rejects.toMatchObject({
      kind: {
        kind: "server-error",
        status: 503,
        message: "Hono API responded 503",
      },
    } satisfies Partial<InstanceType<typeof ApiError>>);
  });

  it("aborts stalled upstream requests after the configured timeout", async () => {
    vi.useFakeTimers();
    process.env.API_FETCH_TIMEOUT_MS = "5";
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      });
    });
    const { apiFetch } = await getClient();

    const assertion = expect(
      apiFetch("/plans", { method: "POST", body: {}, token: "t" }),
    ).rejects.toMatchObject({
      kind: {
        kind: "server-error",
        status: 504,
        message: "Hono API request timed out",
      },
    });
    await vi.advanceTimersByTimeAsync(5);

    await assertion;
  });

  it("keeps the timeout active while parsing a stalled response body", async () => {
    vi.useFakeTimers();
    process.env.API_FETCH_TIMEOUT_MS = "5";
    mockFetch.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }),
      }),
    );
    const { apiFetch } = await getClient();

    let settled: "pending" | "resolved" | "rejected" = "pending";
    let rejection: unknown;
    void apiFetch("/plans", { method: "POST", body: {}, token: "t" }).then(
      () => {
        settled = "resolved";
      },
      (error) => {
        settled = "rejected";
        rejection = error;
      },
    );
    await vi.advanceTimersByTimeAsync(5);
    await Promise.resolve();

    expect(settled).toBe("rejected");
    expect(rejection).toMatchObject({
      kind: {
        kind: "server-error",
        status: 504,
        message: "Hono API request timed out",
      },
    });
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

describe("API helper functions", () => {
  it("call apiFetch with the expected paths, methods, and request bodies", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockPlan.session,
    });
    const { getSession, createPlan, balanceTransfer, demoReset } = await getClient();

    await getSession("token-a");
    await createPlan("Tokyo Hyatt", "token-b");
    await balanceTransfer(
      {
        sourceProgramId: "source-program",
        destProgramId: "dest-program",
        amountPoints: 30000,
      },
      "token-c",
    );
    await demoReset("token-d");

    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      `${FAKE_BASE}/session`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      `${FAKE_BASE}/plans`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "Tokyo Hyatt" }),
      }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      3,
      `${FAKE_BASE}/balance-transfer`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sourceProgramId: "source-program",
          destProgramId: "dest-program",
          amountPoints: 30000,
        }),
      }),
    );
    expect(mockFetch).toHaveBeenNthCalledWith(
      4,
      `${FAKE_BASE}/demo/reset`,
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("submitBalances", () => {
  it("POSTs the balances payload to /balances and returns the body", async () => {
    const payload = {
      userId: "u1",
      balances: [{ programId: "p1", points: 120000 }],
    };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => payload });
    const { submitBalances } = await getClient();

    const result = await submitBalances([{ programId: "p1", points: 120000 }], "token-x");

    expect(result).toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith(
      `${FAKE_BASE}/balances`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ balances: [{ programId: "p1", points: 120000 }] }),
        headers: expect.objectContaining({ Authorization: "Bearer token-x" }),
      }),
    );
  });

  it("preserves the server's validation message on a 400 instead of a generic one", async () => {
    const message = "balances[0].points must be a non-negative safe integer";
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: message }) });
    const { submitBalances } = await getClient();
    const { ApiError } = await import("./types");

    try {
      await submitBalances([{ programId: "p1", points: -1 }], "token-x");
      expect.unreachable("submitBalances should reject on a 400");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as InstanceType<typeof ApiError>).kind).toMatchObject({
        kind: "server-error",
        status: 400,
        message,
      });
    }
  });
});

describe("ApiError", () => {
  it("preserves backend messages for server errors", async () => {
    const { ApiError } = await import("./types");
    const error = new ApiError({
      kind: "server-error",
      status: 502,
      message: "bridge failed",
    });

    expect(error.message).toBe("bridge failed");
  });
});
