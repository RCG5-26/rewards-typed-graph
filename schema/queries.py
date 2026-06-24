from dataclasses import dataclass
from typing import Any

MAX_REDEMPTION_PATH_HOPS = 4

_FIND_REDEMPTION_PATHS_SQL = """
WITH RECURSIVE paths AS (
  SELECT
    user_balances.id AS source_balance_id,
    user_balances.program_id AS source_program_id,
    user_balances.program_id AS current_program_id,
    0::integer AS hop_count,
    10000::bigint AS effective_ratio_basis_points,
    0::integer AS transfer_time_days
  FROM user_balances
  WHERE user_balances.user_id = %s
    AND user_balances.balance_points > 0

  UNION ALL

  SELECT
    paths.source_balance_id,
    paths.source_program_id,
    route.dest_program_id AS current_program_id,
    paths.hop_count + 1 AS hop_count,
    (
      paths.effective_ratio_basis_points::bigint
      * route.transfer_ratio_basis_points::bigint
    ) / 10000::bigint AS effective_ratio_basis_points,
    paths.transfer_time_days + COALESCE(route.transfer_time_days, 0)
      AS transfer_time_days
  FROM paths
  JOIN transfers_to route
    ON route.source_program_id = paths.current_program_id
  WHERE paths.hop_count < %s
    AND route.is_active
    AND (route.valid_from IS NULL OR route.valid_from <= now())
    AND (route.valid_until IS NULL OR route.valid_until > now())
)
SELECT
  paths.source_balance_id,
  paths.source_program_id,
  paths.current_program_id AS destination_program_id,
  redemption_options.id AS redemption_option_id,
  paths.hop_count,
  paths.effective_ratio_basis_points,
  redemption_options.cpp_basis_points,
  NULLIF(paths.transfer_time_days, 0) AS transfer_time_days,
  redemption_options.description
FROM paths
JOIN redeems_via
  ON redeems_via.program_id = paths.current_program_id
JOIN redemption_options
  ON redemption_options.id = redeems_via.redemption_option_id
WHERE paths.hop_count > 0
ORDER BY
  paths.hop_count ASC,
  redemption_options.cpp_basis_points DESC,
  paths.effective_ratio_basis_points DESC,
  redemption_options.id ASC
"""


@dataclass(frozen=True)
class RedemptionPath:
    source_balance_id: str
    source_program_id: str
    destination_program_id: str
    redemption_option_id: str
    hop_count: int
    effective_ratio_basis_points: int
    cpp_basis_points: int
    transfer_time_days: int | None
    description: str | None


def find_redemption_paths(
    connection: Any,
    user_id: str,
    max_hops: int = 2,
) -> list[RedemptionPath]:
    if not user_id:
        raise ValueError("user_id is required")
    if max_hops < 0:
        raise ValueError("max_hops must be nonnegative")
    if max_hops > MAX_REDEMPTION_PATH_HOPS:
        raise ValueError(f"max_hops must be at most {MAX_REDEMPTION_PATH_HOPS}")

    with connection.cursor() as cursor:
        cursor.execute(_FIND_REDEMPTION_PATHS_SQL, (user_id, max_hops))
        rows = cursor.fetchall()

    return [_redemption_path_from_row(row) for row in rows]


def _redemption_path_from_row(row: tuple[Any, ...]) -> RedemptionPath:
    return RedemptionPath(
        source_balance_id=str(row[0]),
        source_program_id=str(row[1]),
        destination_program_id=str(row[2]),
        redemption_option_id=str(row[3]),
        hop_count=int(row[4]),
        effective_ratio_basis_points=int(row[5]),
        cpp_basis_points=int(row[6]),
        transfer_time_days=None if row[7] is None else int(row[7]),
        description=None if row[8] is None else str(row[8]),
    )
