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
  const { balances, statuses, goals } = await readConsistentRows(client, userId);

  // Validate the raw snake_case rows BEFORE coercion. `String(null)` → "null"
  // and `Number(null)` → 0, so a post-coercion check can never see the original
  // null — bad DB rows would cross the GraphSnapshot boundary as valid data.
  validateRawRows({ userId, balances, statuses, goals });

  return {
    userBalances: balances.map(toBalanceRow),
    userProgramStatuses: statuses.map(toStatusRow),
    userGoals: goals.map(toGoalRow),
  };
}

/**
 * Read the three tables inside one READ ONLY REPEATABLE READ transaction so the
 * planner observes a single consistent commit state. Without the transaction, a
 * concurrent write landing between the SELECTs could tear the snapshot (balances
 * from one commit state, goals from another), violating the cross-table read
 * contract. node-pg serializes statements on a single client, and REPEATABLE
 * READ fixes the snapshot at the first statement, so all three SELECTs agree.
 */
async function readConsistentRows(
  client: PoolClient,
  userId: string,
): Promise<{ balances: BalanceRow[]; statuses: StatusRow[]; goals: GoalRow[] }> {
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
  try {
    const [balancesResult, statusesResult, goalsResult] = await Promise.all([
      client.query<BalanceRow>(BALANCE_QUERY, [userId]),
      client.query<StatusRow>(STATUS_QUERY, [userId]),
      client.query<GoalRow>(GOAL_QUERY, [userId]),
    ]);
    await client.query("COMMIT");
    return {
      balances: balancesResult.rows,
      statuses: statusesResult.rows,
      goals: goalsResult.rows,
    };
  } catch (err) {
    // Best-effort rollback; surface the original failure, not a rollback error.
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Present, non-null value that coerces to a finite integer (rejects null → 0). */
function isPresentInteger(value: unknown): boolean {
  if (value === null || value === undefined || value === "") {
    return false;
  }
  return Number.isInteger(Number(value));
}

// The four valid UserGoalType values (agents/contracts). Goal rows were
// previously mapped without validating goal_type at all.
const VALID_GOAL_TYPES: ReadonlySet<string> = new Set([
  "maximize_points",
  "maximize_cashback",
  "specific_redemption",
  "minimize_fees",
]);

function validateRawRows(params: {
  userId: string;
  balances: BalanceRow[];
  statuses: StatusRow[];
  goals: GoalRow[];
}): void {
  for (const row of params.balances) {
    if (!isNonEmptyString(row.id) || !isNonEmptyString(row.program_id)) {
      throw new CommitFailure(
        "ValidationError",
        `malformed user_balance row for user ${params.userId}`,
      );
    }
    if (!isPresentInteger(row.balance_points) || Number(row.balance_points) < 0) {
      throw new CommitFailure("ValidationError", `invalid balance_points on row ${row.id}`);
    }
    if (!isPresentInteger(row.version) || Number(row.version) < 0) {
      throw new CommitFailure("ValidationError", `invalid version on balance row ${row.id}`);
    }
  }

  for (const row of params.statuses) {
    if (
      !isNonEmptyString(row.id) ||
      !isNonEmptyString(row.program_id) ||
      !isNonEmptyString(row.status_tier)
    ) {
      throw new CommitFailure(
        "ValidationError",
        `malformed user_program_status row for user ${params.userId}`,
      );
    }
    if (!isPresentInteger(row.version) || Number(row.version) < 0) {
      throw new CommitFailure("ValidationError", `invalid version on status row ${row.id}`);
    }
  }

  for (const row of params.goals) {
    if (!isNonEmptyString(row.id)) {
      throw new CommitFailure(
        "ValidationError",
        `malformed user_goal row for user ${params.userId}`,
      );
    }
    if (!isNonEmptyString(row.goal_type) || !VALID_GOAL_TYPES.has(row.goal_type)) {
      throw new CommitFailure(
        "ValidationError",
        `invalid goal_type on row ${row.id}: ${String(row.goal_type)}`,
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
     ORDER BY cpp_basis_points DESC, id ASC
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
