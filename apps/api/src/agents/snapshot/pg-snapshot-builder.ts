/**
 * M1 — Production GraphSnapshotBuilder backed by a read-only pg.Pool.
 *
 * Invariants:
 *  - User-scoped: every query is filtered by userId; cross-user reads are
 *    structurally impossible from this path.
 *  - Read-only: only SELECT statements. Pool is passed in by the caller;
 *    this module never initiates writes.
 *  - Deterministic ordering: all arrays ordered by a stable column (id or
 *    program_id) so specialists see consistent snapshots across invocations.
 *  - Contract drift: UserGoalRow.targetRedemptionOptionId has no direct DB
 *    column. It is resolved by a LATERAL JOIN picking the highest-cpp
 *    redemption_option for the goal's target_program_id.
 */

import type { Pool, PoolClient } from "pg";

import type {
  GraphSnapshot,
  GraphSnapshotBuilder,
  UserBalanceRow,
  UserGoalRow,
  UserProgramStatusRow,
} from "../contracts";
import { CommitFailure } from "../contracts";

export class PgGraphSnapshotBuilder implements GraphSnapshotBuilder {
  constructor(private readonly pool: Pool) {}

  async build(input: { userId: string; planId: string }): Promise<GraphSnapshot> {
    const { userId } = input;

    if (!userId || typeof userId !== "string") {
      throw new CommitFailure("ValidationError", "userId is required for snapshot build");
    }

    const client = await this.pool.connect();
    try {
      return await buildSnapshot(client, userId);
    } finally {
      client.release();
    }
  }
}

async function buildSnapshot(client: PoolClient, userId: string): Promise<GraphSnapshot> {
  const [balancesResult, statusesResult, goalsResult] = await Promise.all([
    client.query<BalanceRow>(BALANCE_QUERY, [userId]),
    client.query<StatusRow>(STATUS_QUERY, [userId]),
    client.query<GoalRow>(GOAL_QUERY, [userId]),
  ]);

  const userBalances = balancesResult.rows.map(toBalanceRow);
  const userProgramStatuses = statusesResult.rows.map(toStatusRow);
  const userGoals = goalsResult.rows.map(toGoalRow);

  validateSnapshot({ userId, userBalances, userProgramStatuses });

  return { userBalances, userProgramStatuses, userGoals };
}

function validateSnapshot(params: {
  userId: string;
  userBalances: UserBalanceRow[];
  userProgramStatuses: UserProgramStatusRow[];
}): void {
  for (const balance of params.userBalances) {
    if (!balance.id || !balance.programId) {
      throw new CommitFailure(
        "ValidationError",
        `malformed user_balance row for user ${params.userId}`,
      );
    }
    if (!Number.isInteger(balance.balancePoints) || balance.balancePoints < 0) {
      throw new CommitFailure(
        "ValidationError",
        `invalid balance_points on row ${balance.id}`,
      );
    }
    if (!Number.isInteger(balance.version) || balance.version < 0) {
      throw new CommitFailure(
        "ValidationError",
        `invalid version on balance row ${balance.id}`,
      );
    }
  }

  for (const status of params.userProgramStatuses) {
    if (!status.id || !status.programId || !status.statusTier) {
      throw new CommitFailure(
        "ValidationError",
        `malformed user_program_status row for user ${params.userId}`,
      );
    }
  }
}

// ──────────────────────────────────────────────
// Query definitions
// ──────────────────────────────────────────────

const BALANCE_QUERY = `
  SELECT id, program_id, balance_points, version
    FROM user_balances
   WHERE user_id = $1
   ORDER BY program_id
`;

const STATUS_QUERY = `
  SELECT id, program_id, status_tier, version
    FROM user_program_statuses
   WHERE user_id = $1
   ORDER BY program_id
`;

/**
 * Contract drift note: user_goals.target_program_id → resolved to
 * redemption_options.id by picking the highest cpp_basis_points option.
 * If the goal has no target_program_id or no matching option, the field is null.
 */
const GOAL_QUERY = `
  SELECT
    ug.id,
    ug.goal_type,
    best_ro.id AS target_redemption_option_id
  FROM user_goals ug
  LEFT JOIN LATERAL (
    SELECT id
      FROM redemption_options
     WHERE program_id = ug.target_program_id
     ORDER BY cpp_basis_points DESC
     LIMIT 1
  ) best_ro ON true
  WHERE ug.user_id = $1
  ORDER BY ug.id
`;

// ──────────────────────────────────────────────
// Row types (pg driver returns snake_case strings)
// ──────────────────────────────────────────────

interface BalanceRow {
  id: string;
  program_id: string;
  balance_points: number;
  version: number;
}

interface StatusRow {
  id: string;
  program_id: string;
  status_tier: string;
  version: number;
}

interface GoalRow {
  id: string;
  goal_type: string;
  target_redemption_option_id: string | null;
}

// ──────────────────────────────────────────────
// Row mappers
// ──────────────────────────────────────────────

function toBalanceRow(row: BalanceRow): UserBalanceRow {
  return {
    id: String(row.id),
    programId: String(row.program_id),
    balancePoints: Number(row.balance_points),
    version: Number(row.version),
  };
}

function toStatusRow(row: StatusRow): UserProgramStatusRow {
  return {
    id: String(row.id),
    programId: String(row.program_id),
    statusTier: String(row.status_tier),
    version: Number(row.version),
  };
}

function toGoalRow(row: GoalRow): UserGoalRow {
  return {
    id: String(row.id),
    goalType: row.goal_type as UserGoalRow["goalType"],
    targetRedemptionOptionId: row.target_redemption_option_id
      ? String(row.target_redemption_option_id)
      : null,
  };
}
