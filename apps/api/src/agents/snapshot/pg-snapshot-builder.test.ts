/**
 * Tests for PgGraphSnapshotBuilder (M1).
 *
 * Unit tests use a mock pg.Pool that returns canned rows.
 * Live-PG tests are gated by RUN_LIVE_POSTGRES_TESTS=1 and require a seeded DB.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient, QueryResult } from "pg";

import { CommitFailure } from "../contracts";
import { PgGraphSnapshotBuilder } from "./pg-snapshot-builder";

// ──────────────────────────────────────────────
// Mock pool helpers
// ──────────────────────────────────────────────

type MockRows = Record<string, unknown[]>;

function mockPool(queryResponses: MockRows): Pool {
  const client = {
    query: vi.fn().mockImplementation((sql: string) => {
      const key = resolveQueryKey(sql);
      const rows = queryResponses[key] ?? [];
      return Promise.resolve({ rows } as QueryResult);
    }),
    release: vi.fn(),
  } as unknown as PoolClient;

  return {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
}

function resolveQueryKey(sql: string): string {
  const trimmed = sql.trim().toLowerCase();
  if (trimmed.includes("user_balances") && trimmed.includes("where user_id")) {
    return "balances";
  }
  if (trimmed.includes("user_program_statuses")) {
    return "statuses";
  }
  if (trimmed.includes("user_goals")) {
    return "goals";
  }
  return "unknown";
}

// ──────────────────────────────────────────────
// Fixture rows (demo-seed-v1 values)
// ──────────────────────────────────────────────

const CHASE_BALANCE = {
  id: "00000000-0000-0000-0000-00000000d001",
  program_id: "00000000-0000-0000-0000-00000000b001",
  balance_points: 180000,
  version: 1,
};

const HYATT_BALANCE = {
  id: "00000000-0000-0000-0000-00000000d002",
  program_id: "00000000-0000-0000-0000-00000000b002",
  balance_points: 30000,
  version: 1,
};

const CHASE_STATUS = {
  id: "00000000-0000-0000-0000-00000000d201",
  program_id: "00000000-0000-0000-0000-00000000b001",
  status_tier: "member",
  version: 1,
};

const HYATT_GOAL = {
  id: "00000000-0000-0000-0000-00000000d301",
  goal_type: "specific_redemption",
  target_redemption_option_id: "00000000-0000-0000-0000-00000000f001",
};

const USER_ID = "00000000-0000-0000-0000-00000000a001";

// ──────────────────────────────────────────────
// Unit tests
// ──────────────────────────────────────────────

describe("PgGraphSnapshotBuilder (unit)", () => {
  it("builds snapshot with correct user data", async () => {
    const pool = mockPool({
      balances: [CHASE_BALANCE, HYATT_BALANCE],
      statuses: [CHASE_STATUS],
      goals: [HYATT_GOAL],
    });

    const builder = new PgGraphSnapshotBuilder(pool);
    const snapshot = await builder.build({ userId: USER_ID, planId: "plan-1" });

    expect(snapshot.userBalances).toHaveLength(2);
    expect(snapshot.userBalances[0]).toMatchObject({
      id: CHASE_BALANCE.id,
      programId: CHASE_BALANCE.program_id,
      balancePoints: 180000,
      version: 1,
    });

    expect(snapshot.userProgramStatuses).toHaveLength(1);
    expect(snapshot.userProgramStatuses[0]).toMatchObject({
      programId: CHASE_STATUS.program_id,
      statusTier: "member",
    });

    expect(snapshot.userGoals).toHaveLength(1);
    expect(snapshot.userGoals[0].targetRedemptionOptionId).toBe(
      "00000000-0000-0000-0000-00000000f001",
    );
  });

  it("returns empty arrays when user has no balances/statuses/goals", async () => {
    const pool = mockPool({ balances: [], statuses: [], goals: [] });
    const builder = new PgGraphSnapshotBuilder(pool);
    const snapshot = await builder.build({ userId: "unknown-user", planId: "plan-1" });

    expect(snapshot.userBalances).toHaveLength(0);
    expect(snapshot.userProgramStatuses).toHaveLength(0);
    expect(snapshot.userGoals).toHaveLength(0);
  });

  it("sets targetRedemptionOptionId to null when goal has no target_program", async () => {
    const pool = mockPool({
      balances: [],
      statuses: [],
      goals: [{ id: "goal-1", goal_type: "maximize_points", target_redemption_option_id: null }],
    });
    const builder = new PgGraphSnapshotBuilder(pool);
    const snapshot = await builder.build({ userId: USER_ID, planId: "plan-1" });

    expect(snapshot.userGoals[0].targetRedemptionOptionId).toBeNull();
  });

  it("throws ValidationError on empty userId", async () => {
    const pool = mockPool({});
    const builder = new PgGraphSnapshotBuilder(pool);

    await expect(builder.build({ userId: "", planId: "plan-1" })).rejects.toMatchObject({
      kind: "ValidationError",
    });
  });

  it("throws ValidationError for malformed balance row (negative points)", async () => {
    const pool = mockPool({
      balances: [{ ...CHASE_BALANCE, balance_points: -1 }],
      statuses: [],
      goals: [],
    });
    const builder = new PgGraphSnapshotBuilder(pool);

    await expect(builder.build({ userId: USER_ID, planId: "plan-1" })).rejects.toMatchObject({
      kind: "ValidationError",
    });
  });

  it("throws ValidationError for malformed balance row (missing id)", async () => {
    const pool = mockPool({
      balances: [{ id: "", program_id: "b001", balance_points: 100, version: 0 }],
      statuses: [],
      goals: [],
    });
    const builder = new PgGraphSnapshotBuilder(pool);

    await expect(builder.build({ userId: USER_ID, planId: "plan-1" })).rejects.toMatchObject({
      kind: "ValidationError",
    });
  });

  it("releases client even when query fails", async () => {
    const client = {
      query: vi.fn().mockRejectedValue(new Error("DB connection lost")),
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;

    const builder = new PgGraphSnapshotBuilder(pool);
    await expect(builder.build({ userId: USER_ID, planId: "plan-1" })).rejects.toThrow(
      "DB connection lost",
    );

    expect(client.release).toHaveBeenCalledOnce();
  });

  it("runs all three queries in parallel (connect called once)", async () => {
    const pool = mockPool({
      balances: [CHASE_BALANCE],
      statuses: [CHASE_STATUS],
      goals: [HYATT_GOAL],
    });
    const connectSpy = vi.spyOn(pool, "connect");

    await (new PgGraphSnapshotBuilder(pool)).build({ userId: USER_ID, planId: "plan-1" });

    expect(connectSpy).toHaveBeenCalledOnce();
  });

  it("rejects a null version before coercion (would otherwise become 0)", async () => {
    const pool = mockPool({
      balances: [{ ...CHASE_BALANCE, version: null }],
      statuses: [],
      goals: [],
    });
    const builder = new PgGraphSnapshotBuilder(pool);

    await expect(builder.build({ userId: USER_ID, planId: "plan-1" })).rejects.toMatchObject({
      kind: "ValidationError",
    });
  });

  it("rejects a null id before coercion (would otherwise become \"null\")", async () => {
    const pool = mockPool({
      balances: [{ ...CHASE_BALANCE, id: null }],
      statuses: [],
      goals: [],
    });
    const builder = new PgGraphSnapshotBuilder(pool);

    await expect(builder.build({ userId: USER_ID, planId: "plan-1" })).rejects.toMatchObject({
      kind: "ValidationError",
    });
  });

  it("rejects an invalid goal_type (goal rows were previously unvalidated)", async () => {
    const pool = mockPool({
      balances: [],
      statuses: [],
      goals: [{ id: "g1", goal_type: "not_a_real_goal", target_redemption_option_id: null }],
    });
    const builder = new PgGraphSnapshotBuilder(pool);

    await expect(builder.build({ userId: USER_ID, planId: "plan-1" })).rejects.toMatchObject({
      kind: "ValidationError",
    });
  });

  it("reads under a READ ONLY REPEATABLE READ transaction", async () => {
    const calls: string[] = [];
    const client = {
      query: vi.fn().mockImplementation((sql: string) => {
        const text = typeof sql === "string" ? sql : "";
        calls.push(text);
        const key = resolveQueryKey(text);
        const rows =
          key === "balances"
            ? [CHASE_BALANCE]
            : key === "statuses"
              ? [CHASE_STATUS]
              : key === "goals"
                ? [HYATT_GOAL]
                : [];
        return Promise.resolve({ rows } as QueryResult);
      }),
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;

    await new PgGraphSnapshotBuilder(pool).build({ userId: USER_ID, planId: "plan-1" });

    const begin = calls.find((s) => s.toUpperCase().includes("BEGIN"));
    expect(begin).toBeDefined();
    expect(begin!.toUpperCase()).toContain("REPEATABLE READ");
    expect(begin!.toUpperCase()).toContain("READ ONLY");
    expect(calls.some((s) => s.toUpperCase().includes("COMMIT"))).toBe(true);
  });
});

// ──────────────────────────────────────────────
// Live PostgreSQL integration tests
// Gated by RUN_LIVE_POSTGRES_TESTS=1
// ──────────────────────────────────────────────

const LIVE = process.env.RUN_LIVE_POSTGRES_TESTS === "1";

(LIVE ? describe : describe.skip)("PgGraphSnapshotBuilder (live-PG)", () => {
  let pool: Pool;

  beforeAll(async () => {
    const { Pool } = await import("pg");
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it("builds a snapshot for the demo user (demo-seed-v1)", async () => {
    const builder = new PgGraphSnapshotBuilder(pool);
    const snapshot = await builder.build({ userId: USER_ID, planId: "plan-any" });

    expect(snapshot.userBalances.length).toBeGreaterThanOrEqual(1);

    const chase = snapshot.userBalances.find(
      (b) => b.programId === "00000000-0000-0000-0000-00000000b001",
    );
    expect(chase).toBeDefined();
    expect(chase!.balancePoints).toBeGreaterThanOrEqual(0);
  });

  it("returns deterministic ordering across two calls", async () => {
    const builder = new PgGraphSnapshotBuilder(pool);
    const [a, b] = await Promise.all([
      builder.build({ userId: USER_ID, planId: "plan-1" }),
      builder.build({ userId: USER_ID, planId: "plan-1" }),
    ]);

    const idsA = a.userBalances.map((b) => b.id);
    const idsB = b.userBalances.map((b) => b.id);
    expect(idsA).toEqual(idsB);
  });

  it("resolves targetRedemptionOptionId for the Hyatt goal (d301)", async () => {
    const builder = new PgGraphSnapshotBuilder(pool);
    const snapshot = await builder.build({ userId: USER_ID, planId: "plan-1" });

    const goal = snapshot.userGoals.find(
      (g) => g.id === "00000000-0000-0000-0000-00000000d301",
    );
    expect(goal).toBeDefined();
    expect(goal!.targetRedemptionOptionId).toBe("00000000-0000-0000-0000-00000000f001");
  });

  it("cannot read another user's balances (cross-user isolation)", async () => {
    const builder = new PgGraphSnapshotBuilder(pool);
    const snapshot = await builder.build({
      userId: "00000000-0000-0000-0000-deadbeef0000",
      planId: "plan-1",
    });
    expect(snapshot.userBalances).toHaveLength(0);
  });

  // Regression for the LATERAL tiebreaker: ORDER BY cpp_basis_points DESC, id ASC.
  // Two options with identical cpp must resolve deterministically to the lower id,
  // otherwise targetRedemptionOptionId could flap across identical snapshot builds.
  describe("tiebreaker on equal cpp_basis_points", () => {
    const TB_USER = "00000000-0000-0000-0000-00000000e001";
    const TB_PROGRAM = "00000000-0000-0000-0000-00000000e010";
    const TB_OPTION_LOW = "00000000-0000-0000-0000-00000000e0a1";
    const TB_OPTION_HIGH = "00000000-0000-0000-0000-00000000e0b2";
    const TB_GOAL = "00000000-0000-0000-0000-00000000e020";

    async function cleanup(): Promise<void> {
      await pool.query("DELETE FROM user_goals WHERE id = $1", [TB_GOAL]);
      await pool.query("DELETE FROM redemption_options WHERE id = ANY($1::uuid[])", [
        [TB_OPTION_LOW, TB_OPTION_HIGH],
      ]);
      await pool.query("DELETE FROM reward_programs WHERE id = $1", [TB_PROGRAM]);
      await pool.query("DELETE FROM users WHERE id = $1", [TB_USER]);
    }

    beforeAll(async () => {
      await cleanup(); // clear any residue from a failed prior run
      await pool.query(
        `INSERT INTO users (id, clerk_id, email) VALUES ($1, $2, $3)`,
        [TB_USER, "tiebreak-fixture-user", "tiebreak@example.test"],
      );
      await pool.query(
        `INSERT INTO reward_programs (id, slug, name, program_kind, currency_name)
         VALUES ($1, $2, $3, 'hotel', 'Points')`,
        [TB_PROGRAM, "tiebreak-fixture-program", "Tiebreak Fixture Program"],
      );
      // Same cpp_basis_points; the lower id must win.
      await pool.query(
        `INSERT INTO redemption_options (id, program_id, option_type, cpp_basis_points)
         VALUES ($1, $3, 'transfer_partner', 150), ($2, $3, 'transfer_partner', 150)`,
        [TB_OPTION_HIGH, TB_OPTION_LOW, TB_PROGRAM],
      );
      await pool.query(
        `INSERT INTO user_goals (id, user_id, goal_type, description, target_program_id)
         VALUES ($1, $2, 'maximize_points', 'tiebreak fixture goal', $3)`,
        [TB_GOAL, TB_USER, TB_PROGRAM],
      );
    });

    afterAll(async () => {
      await cleanup();
    });

    it("selects the lower id when cpp_basis_points are equal", async () => {
      const builder = new PgGraphSnapshotBuilder(pool);
      const snapshot = await builder.build({ userId: TB_USER, planId: "plan-tiebreak" });

      const goal = snapshot.userGoals.find((g) => g.id === TB_GOAL);
      expect(goal).toBeDefined();
      expect(goal!.targetRedemptionOptionId).toBe(TB_OPTION_LOW);
    });
  });
});
