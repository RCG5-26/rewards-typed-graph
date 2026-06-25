/**
 * Tests for GET /api/plan/stream — live API re-paced SSE.
 * RCG-25 (initial plan stream) and RCG-26 (replan invalidation stream).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiBalanceTransferResponse, ApiPlan } from "@/lib/api/types";
import { ApiError } from "@/lib/api/types";

import mockPlan from "@/fixtures/mock-plan.json";

// ── Module mocks (vi.mock is hoisted above all imports) ──────────────────────

vi.mock("@/lib/api/client", () => ({
  createPlan: vi.fn(),
  balanceTransfer: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@/lib/api/adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/adapters")>();
  return {
    ...actual,
    transferParamsFromPersona: vi
      .fn()
      .mockReturnValue({ sourceProgramId: "b001", destProgramId: "b002", amountPoints: 30000 }),
  };
});

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ getToken: async () => "test-token" }),
}));

// Static import so route.ts and its deps are transformed during Vitest's
// collect phase, avoiding a cold-start timeout on the first streaming test.
import { GET } from "./route";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function collectFrames(
  response: Response,
): Promise<{ event: string; data: unknown }[]> {
  const text = await response.text();
  const frames: { event: string; data: unknown }[] = [];
  const blocks = text.split("\n\n").filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n");
    const event =
      lines.find((l) => l.startsWith("event: "))?.replace("event: ", "") ?? "";
    const dataLine =
      lines.find((l) => l.startsWith("data: "))?.replace("data: ", "") ?? "{}";
    frames.push({ event, data: JSON.parse(dataLine) });
  }
  return frames;
}

function makeRequest(search: string): Request {
  return new Request(`http://localhost:3000/api/plan/stream${search}`);
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe("GET /api/plan/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it(
    "initial stream: meta → mutations → done(revision=1) [RCG-25]",
    async () => {
      const { createPlan } = await import("@/lib/api/client");
      const { auth } = await import("@clerk/nextjs/server");
      vi.mocked(auth).mockResolvedValue({ getToken: async () => "test-token" });
      vi.mocked(createPlan).mockResolvedValue(mockPlan.createPlan as ApiPlan);

      const response = await GET(makeRequest("?q=test+query"));

      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      const frames = await collectFrames(response);

      expect(frames[0].event).toBe("meta");
      expect(frames.some((f) => f.event === "mutation")).toBe(true);

      const done = frames[frames.length - 1];
      expect(done.event).toBe("done");
      expect((done.data as { revision: number }).revision).toBe(1);
    },
    15_000,
  );

  it(
    "replan stream: invalidation → meta → mutations → done(revision=2) [RCG-26]",
    async () => {
      const { balanceTransfer, getSession } = await import("@/lib/api/client");
      const { auth } = await import("@clerk/nextjs/server");
      vi.mocked(auth).mockResolvedValue({ getToken: async () => "test-token" });
      vi.mocked(getSession).mockResolvedValue({ userId: "u1", clerkId: "clerk_u1", seeded: true });
      vi.mocked(balanceTransfer).mockResolvedValue(
        mockPlan.balanceTransfer as ApiBalanceTransferResponse,
      );

      const response = await GET(makeRequest("?q=test+query&replan=1"));

      const frames = await collectFrames(response);

      const invalidationFrame = frames.find((f) => f.event === "invalidation");
      expect(invalidationFrame).toBeDefined();
      expect(
        (invalidationFrame!.data as { staleEdgeId: string }).staleEdgeId,
      ).toBeTruthy();

      const invalidationIdx = frames.findIndex((f) => f.event === "invalidation");
      const metaIdx = frames.findIndex((f) => f.event === "meta");
      expect(invalidationIdx).toBeLessThan(metaIdx);

      expect(frames.some((f) => f.event === "mutation")).toBe(true);

      const done = frames[frames.length - 1];
      expect(done.event).toBe("done");
      expect((done.data as { revision: number }).revision).toBe(2);
    },
    15_000,
  );

  it("no token → 401 JSON (not SSE)", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValue({ getToken: async () => null });

    const response = await GET(makeRequest("?q=test+query"));

    expect(response.status).toBe(401);
    const contentType = response.headers.get("Content-Type") ?? "";
    expect(contentType).not.toContain("text/event-stream");
  });

  it("API error mid-stream → error frame", async () => {
    const { createPlan } = await import("@/lib/api/client");
    const { auth } = await import("@clerk/nextjs/server");
    vi.mocked(auth).mockResolvedValue({ getToken: async () => "test-token" });
    vi.mocked(createPlan).mockRejectedValue(
      new ApiError({ kind: "server-error", status: 500, message: "bridge failed" }),
    );

    const response = await GET(makeRequest("?q=test+query"));

    const frames = await collectFrames(response);
    expect(frames.some((f) => f.event === "error")).toBe(true);
  });

  it("replan with no transfer source → error frame", async () => {
    const { getSession } = await import("@/lib/api/client");
    const { auth } = await import("@clerk/nextjs/server");
    const adaptersMod = await import("@/lib/api/adapters");
    vi.mocked(auth).mockResolvedValue({ getToken: async () => "test-token" });
    vi.mocked(getSession).mockResolvedValue({ userId: "u1", clerkId: "clerk_u1", seeded: false });
    vi.mocked(adaptersMod.transferParamsFromPersona).mockImplementation(() => {
      throw new ApiError({ kind: "server-error", status: 422, message: "non-seeded" });
    });

    const response = await GET(makeRequest("?q=test+query&replan=1"));

    const frames = await collectFrames(response);
    expect(frames.some((f) => f.event === "error")).toBe(true);
  });
});
