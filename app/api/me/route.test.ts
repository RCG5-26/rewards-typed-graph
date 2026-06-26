import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/types";

vi.mock("@/lib/api/client", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/user/session", () => ({
  resolveSessionGraph: vi.fn(),
}));

const CLERK_ID = "user_1";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ getToken: async () => "test-token", userId: "user_1" }),
}));

const { GET } = await import("./route");
const { getSession } = await import("@/lib/api/client");
const { resolveSessionGraph } = await import("@/lib/user/session");
const { auth } = await import("@clerk/nextjs/server");

const mockGetSession = vi.mocked(getSession);
const mockResolveSessionGraph = vi.mocked(resolveSessionGraph);
const mockAuth = vi.mocked(auth);

const sampleGraph = {
  user: {
    id: "u1",
    clerkId: "ck1",
    email: null,
    displayName: "Alex Demo",
    imageUrl: null,
    isDemoPersona: true,
  },
  balances: [
    {
      programId: "p1",
      programName: "Chase UR",
      currencyName: "points",
      balancePoints: 120_000,
    },
  ],
  goals: [],
  holds: [],
};

describe("GET /api/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      getToken: async () => "test-token",
      userId: CLERK_ID,
    } as ReturnType<typeof auth> extends Promise<infer T> ? T : never);
  });

  it("returns 200 with UserGraph when session is provisioned", async () => {
    mockGetSession.mockResolvedValue({ userId: "u1", clerkId: CLERK_ID, seeded: true });
    mockResolveSessionGraph.mockResolvedValue({ ok: true, graph: sampleGraph });

    const response = await GET();
    const body = await response.json();

    expect(mockGetSession).toHaveBeenCalledWith("test-token");
    expect(mockResolveSessionGraph).toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(body).toEqual(sampleGraph);
    // Contract lock: the BFF returns UserGraph, never the old ApiSessionResponse.
    expect(body).not.toHaveProperty("userId");
    expect(body).not.toHaveProperty("seeded");
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

  it("returns 401 when a token is present but the Clerk userId is missing", async () => {
    mockAuth.mockResolvedValue({
      getToken: async () => "test-token",
      userId: null,
    } as ReturnType<typeof auth> extends Promise<infer T> ? T : never);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Not signed in." });
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(mockResolveSessionGraph).not.toHaveBeenCalled();
  });

  it("returns 401 when getSession throws not-signed-in ApiError", async () => {
    mockGetSession.mockRejectedValue(new ApiError({ kind: "not-signed-in", status: 401 }));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Not signed in." });
    expect(mockResolveSessionGraph).not.toHaveBeenCalled();
  });

  it("returns 403 when getSession throws unprovisioned ApiError", async () => {
    mockGetSession.mockRejectedValue(new ApiError({ kind: "unprovisioned", status: 403 }));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "Account not provisioned." });
    expect(mockResolveSessionGraph).not.toHaveBeenCalled();
  });

  it("passes through the resolveSessionGraph 403 response unchanged", async () => {
    mockGetSession.mockResolvedValue({ userId: "u1", clerkId: CLERK_ID, seeded: true });
    const resolvedResponse = NextResponse.json(
      { error: "No account is provisioned for this sign-in." },
      { status: 403 },
    );
    mockResolveSessionGraph.mockResolvedValue({ ok: false, response: resolvedResponse });

    const response = await GET();
    const body = await response.json();

    // getSession provisions before the graph is resolved.
    expect(mockGetSession).toHaveBeenCalledWith("test-token");
    expect(mockResolveSessionGraph).toHaveBeenCalled();
    // The handler returns resolveSessionGraph's response verbatim, not a rewrap.
    expect(response).toBe(resolvedResponse);
    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "No account is provisioned for this sign-in." });
  });

  it("passes through a resolveSessionGraph 401 response after getSession succeeds", async () => {
    mockGetSession.mockResolvedValue({ userId: "u1", clerkId: CLERK_ID, seeded: true });
    mockResolveSessionGraph.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Not signed in." }, { status: 401 }),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Not signed in." });
  });

  it("passes through a resolveSessionGraph 500 response after getSession succeeds", async () => {
    mockGetSession.mockResolvedValue({ userId: "u1", clerkId: CLERK_ID, seeded: true });
    mockResolveSessionGraph.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Could not load your account." }, { status: 500 }),
    });

    const response = await GET();
    expect(response.status).toBe(500);
  });

  it("fails closed with 500 when the Hono session and Clerk identity diverge", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetSession.mockResolvedValue({
      userId: "u1",
      clerkId: "someone_else",
      seeded: true,
    });

    const response = await GET();

    expect(response.status).toBe(500);
    // Identity mismatch must never fall through to graph resolution.
    expect(mockResolveSessionGraph).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
