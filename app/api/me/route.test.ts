import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/types";

vi.mock("@/lib/api/client", () => ({
  getSession: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ getToken: async () => "test-token" }),
}));

// Import after mocks are set up
const { GET } = await import("./route");
const { getSession } = await import("@/lib/api/client");
const { auth } = await import("@clerk/nextjs/server");

const mockGetSession = vi.mocked(getSession);
const mockAuth = vi.mocked(auth);

describe("GET /api/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ getToken: async () => "test-token" } as ReturnType<
      typeof auth
    > extends Promise<infer T>
      ? T
      : never);
  });

  it("returns 200 with session body when authenticated", async () => {
    const sessionData = { userId: "u1", clerkId: "ck1", seeded: true };
    mockGetSession.mockResolvedValue(sessionData);

    const response = await GET();
    const body = await response.json();

    expect(mockGetSession).toHaveBeenCalledWith("test-token");
    expect(response.status).toBe(200);
    expect(body).toEqual(sessionData);
  });

  it("returns 401 when no token is available", async () => {
    mockAuth.mockResolvedValue({ getToken: async () => null } as ReturnType<
      typeof auth
    > extends Promise<infer T>
      ? T
      : never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Not signed in." });
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("returns 401 when getSession throws not-signed-in ApiError", async () => {
    mockGetSession.mockRejectedValue(new ApiError({ kind: "not-signed-in", status: 401 }));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toHaveProperty("error");
  });

  it("returns 403 when getSession throws unprovisioned ApiError", async () => {
    mockGetSession.mockRejectedValue(new ApiError({ kind: "unprovisioned", status: 403 }));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toHaveProperty("error");
  });
});
