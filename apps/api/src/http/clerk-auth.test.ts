import { describe, expect, it, vi } from "vitest";

import { parseBearer, resolveIdentity } from "./clerk-auth";

vi.mock("@clerk/backend", () => ({
  verifyToken: vi.fn(),
}));

import { verifyToken } from "@clerk/backend";

const mockedVerify = vi.mocked(verifyToken);

describe("parseBearer", () => {
  it("extracts a bearer token", () => {
    expect(parseBearer("Bearer abc.def.ghi")).toBe("abc.def.ghi");
  });

  it("returns undefined for missing or malformed headers", () => {
    expect(parseBearer(undefined)).toBeUndefined();
    expect(parseBearer("Basic abc")).toBeUndefined();
    expect(parseBearer("Bearer")).toBeUndefined();
  });
});

describe("resolveIdentity", () => {
  it("short-circuits to AUTH_DEV_USER_ID when configured", async () => {
    const result = await resolveIdentity(
      undefined,
      { devUserId: "00000000-0000-0000-0000-00000000a001" },
      { findUserIdByClerkId: vi.fn() },
    );
    expect(result).toEqual({ userId: "00000000-0000-0000-0000-00000000a001" });
    expect(mockedVerify).not.toHaveBeenCalled();
  });

  it("returns empty identity when token or secret is missing", async () => {
    const lookup = { findUserIdByClerkId: vi.fn() };
    expect(await resolveIdentity(undefined, {}, lookup)).toEqual({});
    expect(await resolveIdentity("Bearer tok", {}, lookup)).toEqual({});
    expect(lookup.findUserIdByClerkId).not.toHaveBeenCalled();
  });

  it("returns clerkId only for a verified token with no users row", async () => {
    mockedVerify.mockResolvedValueOnce({
      sub: "user_new_clerk",
      email: "new@example.com",
    } as unknown as Awaited<ReturnType<typeof verifyToken>>);

    const result = await resolveIdentity(
      "Bearer valid.jwt",
      { clerkSecretKey: "sk_test_x" },
      { findUserIdByClerkId: vi.fn().mockResolvedValue(undefined) },
    );

    expect(result).toEqual({
      userId: undefined,
      clerkId: "user_new_clerk",
      email: "new@example.com",
    });
  });

  it("maps an existing clerk user to userId", async () => {
    mockedVerify.mockResolvedValueOnce({
      sub: "user_existing",
    } as unknown as Awaited<ReturnType<typeof verifyToken>>);

    const result = await resolveIdentity(
      "Bearer valid.jwt",
      { clerkSecretKey: "sk_test_x" },
      {
        findUserIdByClerkId: vi
          .fn()
          .mockResolvedValue("11111111-1111-1111-1111-111111111111"),
      },
    );

    expect(result.userId).toBe("11111111-1111-1111-1111-111111111111");
    expect(result.clerkId).toBe("user_existing");
  });

  it("returns empty identity when token verification fails", async () => {
    mockedVerify.mockRejectedValueOnce(new Error("invalid signature"));

    const result = await resolveIdentity(
      "Bearer bad.jwt",
      { clerkSecretKey: "sk_test_x" },
      { findUserIdByClerkId: vi.fn() },
    );

    expect(result).toEqual({});
  });
});
