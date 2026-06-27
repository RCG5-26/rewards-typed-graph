/**
 * Tests for GET /api/mutations/stream — the SSE proxy of the Hono mutations
 * stream. Covers auth injection, cursor forwarding, the failure branches
 * (401 / 502 / upstream-status), and successful stream pass-through.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ getToken: async () => "test-token" }),
}));

import { GET } from "./route";

type AuthResult = Awaited<ReturnType<typeof import("@clerk/nextjs/server").auth>>;

function mockAuthWithToken(token: string | null) {
  return { getToken: async () => token } as AuthResult;
}

function makeRequest(search = ""): Request {
  return new Request(`http://localhost:3000/api/mutations/stream${search}`);
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  process.env.API_BASE_URL = "http://api.test";
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/mutations/stream", () => {
  it("returns 401 JSON when the caller has no Clerk token", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValue(mockAuthWithToken(null));

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("injects the Bearer token, forwards ?after as Last-Event-ID, and passes the stream through", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValue(mockAuthWithToken("test-token"));
    fetchMock.mockResolvedValue(
      new Response("event: graph_mutation\ndata: {}\n\n", { status: 200 }),
    );

    const response = await GET(makeRequest("?after=42"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://api.test/mutations/stream");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["Last-Event-ID"]).toBe("42");
  });

  it("defaults the cursor to 0 when ?after is absent", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValue(mockAuthWithToken("test-token"));
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    await GET(makeRequest());

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Last-Event-ID"]).toBe("0");
  });

  it("returns 502 when the upstream fetch throws", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValue(mockAuthWithToken("test-token"));
    fetchMock.mockRejectedValue(new Error("connection refused"));

    const response = await GET(makeRequest());

    expect(response.status).toBe(502);
  });

  it("propagates a non-ok upstream status", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValue(mockAuthWithToken("test-token"));
    fetchMock.mockResolvedValue(new Response("nope", { status: 503 }));

    const response = await GET(makeRequest());

    expect(response.status).toBe(503);
  });

  it("returns 502 when the upstream is ok but has no body", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValue(mockAuthWithToken("test-token"));
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    const response = await GET(makeRequest());

    expect(response.status).toBe(502);
  });
});
