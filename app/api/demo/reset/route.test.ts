import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiError } from "@/lib/api/types";

vi.mock("@/lib/api/client", () => ({
  demoReset: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ getToken: async () => "test-token" }),
}));

// Import after mocks are set up
const { POST } = await import("./route");
const { demoReset } = await import("@/lib/api/client");
const { auth } = await import("@clerk/nextjs/server");

const mockDemoReset = vi.mocked(demoReset);
const mockAuth = vi.mocked(auth);

describe("POST /api/demo/reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ getToken: async () => "test-token" } as ReturnType<
      typeof auth
    > extends Promise<infer T>
      ? T
      : never);
  });

  it("returns 200 with reset body when authenticated", async () => {
    const resetData = { userId: "u1", clerkId: "ck1", seeded: true };
    mockDemoReset.mockResolvedValue(resetData);

    const response = await POST();
    const body = await response.json();

    expect(mockDemoReset).toHaveBeenCalledWith("test-token");
    expect(response.status).toBe(200);
    expect(body).toEqual(resetData);
  });

  it("returns 401 when no token is available", async () => {
    mockAuth.mockResolvedValue({ getToken: async () => null } as ReturnType<
      typeof auth
    > extends Promise<infer T>
      ? T
      : never);

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Not signed in." });
    expect(mockDemoReset).not.toHaveBeenCalled();
  });

  it("returns stable ApiError responses without leaking backend messages", async () => {
    mockDemoReset.mockRejectedValue(
      new ApiError({
        kind: "unprovisioned",
        status: 403,
      }),
    );

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "Account not provisioned." });
  });

  it("returns a generic 500 when reset throws an unexpected error", async () => {
    mockDemoReset.mockRejectedValue(new Error("database host leaked"));

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Could not reset demo." });
  });
});
