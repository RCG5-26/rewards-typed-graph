import { describe, it, expect, vi, beforeEach } from "vitest";

import { ApiError } from "@/lib/api/types";

vi.mock("@/lib/api/client", () => ({
  submitBalances: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
}));

const { POST } = await import("./route");
const { submitBalances } = await import("@/lib/api/client");
const { auth } = await import("@clerk/nextjs/server");

const mockSubmit = vi.mocked(submitBalances);
const mockAuth = vi.mocked(auth);

/** Minimal Request stub — the handler only calls `request.json()`. */
function req(body: unknown): Request {
  return { json: async () => body } as unknown as Request;
}

function signedIn() {
  mockAuth.mockResolvedValue({
    getToken: async () => "test-token",
    userId: "user_1",
  } as unknown as Awaited<ReturnType<typeof auth>>);
}

beforeEach(() => {
  mockSubmit.mockReset();
  mockAuth.mockReset();
});

describe("POST /api/balances", () => {
  it("returns 401 when there is no Clerk session", async () => {
    mockAuth.mockResolvedValue({ getToken: async () => null, userId: null } as unknown as Awaited<ReturnType<typeof auth>>);
    const res = await POST(req({ balances: [] }));
    expect(res.status).toBe(401);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("returns 400 when balances is not an array", async () => {
    signedIn();
    const res = await POST(req({ balances: "nope" }));
    expect(res.status).toBe(400);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("returns 400 when the request body is not valid JSON", async () => {
    signedIn();
    const badReq = { json: async () => { throw new SyntaxError("Unexpected token"); } } as unknown as Request;
    const res = await POST(badReq);
    expect(res.status).toBe(400);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("returns 400 when an entry is malformed", async () => {
    signedIn();
    const res = await POST(req({ balances: [{ programId: 123, points: "x" }] }));
    expect(res.status).toBe(400);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("narrows the body and forwards the token to submitBalances on success", async () => {
    signedIn();
    const payload = { userId: "user_1", balances: [{ programId: "p1", points: 120000 }] };
    mockSubmit.mockResolvedValue(payload);
    const res = await POST(req({ balances: [{ programId: "p1", points: 120000, extra: "ignored" }] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
    expect(mockSubmit).toHaveBeenCalledWith([{ programId: "p1", points: 120000 }], "test-token");
  });

  it("maps ApiError not-signed-in to 401", async () => {
    signedIn();
    mockSubmit.mockRejectedValue(new ApiError({ kind: "not-signed-in", status: 401 }));
    const res = await POST(req({ balances: [] }));
    expect(res.status).toBe(401);
  });

  it("maps ApiError unprovisioned to 403", async () => {
    signedIn();
    mockSubmit.mockRejectedValue(new ApiError({ kind: "unprovisioned", status: 403 }));
    const res = await POST(req({ balances: [] }));
    expect(res.status).toBe(403);
  });

  it("maps ApiError misconfigured to 500 with its message", async () => {
    signedIn();
    mockSubmit.mockRejectedValue(
      new ApiError({ kind: "misconfigured", message: "API_BASE_URL is not set" }),
    );
    const res = await POST(req({ balances: [] }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("API_BASE_URL is not set");
  });

  it("forwards an upstream server-error status and validation message", async () => {
    signedIn();
    const message = "balances[0].points must be a non-negative safe integer";
    mockSubmit.mockRejectedValue(new ApiError({ kind: "server-error", status: 400, message }));
    const res = await POST(req({ balances: [{ programId: "p1", points: -1 }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(message);
  });

  it("returns 502 for a non-ApiError failure", async () => {
    signedIn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSubmit.mockRejectedValue(new Error("socket hang up"));
    const res = await POST(req({ balances: [{ programId: "p1", points: 1 }] }));
    expect(res.status).toBe(502);
    errorSpy.mockRestore();
  });
});
