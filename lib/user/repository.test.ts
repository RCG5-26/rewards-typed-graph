import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnd = vi.fn().mockResolvedValue(undefined);
const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockQuery = vi.fn();

const MockClient = vi.fn().mockImplementation(() => ({
  connect: mockConnect,
  query: mockQuery,
  end: mockEnd,
}));

vi.mock("pg", () => ({
  default: { Client: MockClient },
  Client: MockClient,
}));

describe("PostgresUserRepository", () => {
  const originalDbUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.resetModules();
    mockQuery.mockReset();
    mockConnect.mockReset();
    mockEnd.mockReset();
    process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  });

  afterEach(() => {
    if (originalDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDbUrl;
  });

  it("throws UnmappedUserError when clerk_id is not provisioned", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { getUserRepository } = await import("./repository");
    const repo = getUserRepository();

    await expect(repo.getUserGraph("user_unmapped")).rejects.toMatchObject({
      name: "UnmappedUserError",
      message: "No account is provisioned for this sign-in.",
    });
    expect(mockEnd).toHaveBeenCalled();
  });

  it("does not fall back to the first user row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const { getUserRepository } = await import("./repository");

    await expect(getUserRepository().getUserGraph("user_new")).rejects.toThrow(
      /No account is provisioned/,
    );

    const userLookupSql = mockQuery.mock.calls[0]?.[0] as string;
    expect(userLookupSql).toContain("WHERE clerk_id = $1");
    expect(userLookupSql).not.toContain("ORDER BY created_at");
  });

  it("returns a graph for a mapped clerk_id", async () => {
    const userId = "00000000-0000-0000-0000-00000000a001";
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: userId,
            clerk_id: "user_mapped",
            email: "hero@example.com",
            display_name: "Hero",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { getUserRepository } = await import("./repository");
    const graph = await getUserRepository().getUserGraph("user_mapped");

    expect(graph.user.clerkId).toBe("user_mapped");
    expect(graph.user.isDemoPersona).toBe(false);
    expect(mockEnd).toHaveBeenCalled();
  });
});
