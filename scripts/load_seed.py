"""Load the RCG-8 demo seed fixture into the v3.1 Postgres schema."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path
from typing import Any


TableSpec = tuple[str, str, tuple[str, ...], set[str]]


WORLD_TABLE_SPECS: tuple[TableSpec, ...] = (
    (
        "reward_programs",
        "reward_programs",
        (
            "id",
            "slug",
            "name",
            "issuer",
            "program_kind",
            "currency_name",
            "min_redemption_points",
            "points_expire_months",
            "is_active",
        ),
        set(),
    ),
    (
        "credit_cards",
        "credit_cards",
        (
            "id",
            "slug",
            "name",
            "issuer",
            "network",
            "annual_fee_cents",
            "reward_program_id",
            "signup_bonus_points",
            "signup_bonus_spend_cents",
            "signup_bonus_deadline_days",
            "is_active",
        ),
        set(),
    ),
    (
        "spend_categories",
        "spend_categories",
        ("id", "slug", "name", "parent_id", "mcc_codes"),
        set(),
    ),
    (
        "transfers_to",
        "transfers_to",
        (
            "id",
            "source_program_id",
            "dest_program_id",
            "transfer_ratio_basis_points",
            "transfer_time_days",
            "valid_from",
            "valid_until",
            "is_active",
            "version",
        ),
        set(),
    ),
    (
        "redemption_options",
        "redemption_options",
        (
            "id",
            "program_id",
            "option_type",
            "cpp_basis_points",
            "min_points",
            "description",
            "valid_from",
            "valid_until",
        ),
        set(),
    ),
    (
        "redeems_via",
        "redeems_via",
        ("id", "program_id", "redemption_option_id"),
        set(),
    ),
    (
        "earns",
        "earns",
        (
            "id",
            "credit_card_id",
            "spend_category_id",
            "earn_rate_basis_points",
            "earn_type",
            "cap_amount_cents",
        ),
        set(),
    ),
)


DEMO_PERSONA_TABLE_SPECS: tuple[TableSpec, ...] = (
    (
        "users",
        "users",
        ("id", "clerk_id", "email", "display_name"),
        set(),
    ),
    (
        "user_balances",
        "user_balances",
        ("id", "user_id", "program_id", "balance_points", "source", "version"),
        set(),
    ),
    (
        "user_program_statuses",
        "user_program_statuses",
        (
            "id",
            "user_id",
            "program_id",
            "status_tier",
            "status_payload",
            "version",
        ),
        {"status_payload"},
    ),
    (
        "user_goals",
        "user_goals",
        (
            "id",
            "user_id",
            "goal_type",
            "description",
            "target_program_id",
            "target_location",
            "target_date",
            "payload",
        ),
        {"payload"},
    ),
    (
        "holds",
        "holds",
        ("id", "user_id", "credit_card_id", "opened_date", "is_primary"),
        set(),
    ),
)


def load_fixture(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def build_seed_sql(
    fixture: dict[str, Any],
    *,
    include_demo_persona: bool = False,
) -> str:
    """Build idempotent seed SQL.

    Personal demo rows are opt-in for isolated local/eval databases. The app
    bootstrap path should clone the fixture for each Clerk user instead.
    """
    statements = ["BEGIN;"]
    table_specs = WORLD_TABLE_SPECS
    if include_demo_persona:
        table_specs = WORLD_TABLE_SPECS + DEMO_PERSONA_TABLE_SPECS

    for fixture_key, table_name, columns, jsonb_columns in table_specs:
        rows = fixture.get(fixture_key, [])
        if not rows:
            continue
        statements.append(_insert_statement(table_name, columns, rows, jsonb_columns))
    statements.append("COMMIT;")
    return "\n\n".join(statements) + "\n"


def apply_seed(sql: str) -> None:
    """Apply generated seed SQL via psql.

    Uses ``DATABASE_URL`` when set (``postgresql://...``), otherwise libpq
    env vars (``PGHOST``, ``PGDATABASE``, etc.).
    """
    command = ["psql", "--set", "ON_ERROR_STOP=1"]
    database_url = os.environ.get("DATABASE_URL")
    if database_url:
        command.append(database_url)
    subprocess.run(
        command,
        input=sql,
        check=True,
        text=True,
        env=os.environ.copy(),
    )


def _insert_statement(
    table_name: str,
    columns: tuple[str, ...],
    rows: list[dict[str, Any]],
    jsonb_columns: set[str],
) -> str:
    column_sql = ", ".join(columns)
    row_sql = ",\n  ".join(
        _row_sql(row, columns, jsonb_columns)
        for row in rows
    )
    update_sql = ", ".join(
        f"{column} = EXCLUDED.{column}"
        for column in columns
        if column != "id"
    )
    return (
        f"INSERT INTO {table_name} ({column_sql})\n"
        f"VALUES\n"
        f"  {row_sql}\n"
        f"ON CONFLICT (id) DO UPDATE SET {update_sql};"
    )


def _row_sql(
    row: dict[str, Any],
    columns: tuple[str, ...],
    jsonb_columns: set[str],
) -> str:
    values = [
        _literal(row.get(column), as_jsonb=column in jsonb_columns)
        for column in columns
    ]
    return "(" + ", ".join(values) + ")"


def _literal(value: Any, *, as_jsonb: bool = False) -> str:
    if as_jsonb:
        encoded = json.dumps(value if value is not None else {}, sort_keys=True)
        return f"{_quote(encoded)}::jsonb"
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, list):
        if not value:
            return "'{}'"
        return "ARRAY[" + ", ".join(_literal(item) for item in value) + "]"
    return _quote(str(value))


def _quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixture", type=Path, help="Path to fixtures/demo-seed.json")
    parser.add_argument(
        "--print-sql",
        action="store_true",
        help="Print generated SQL instead of applying it with psql.",
    )
    parser.add_argument(
        "--include-demo-persona",
        action="store_true",
        help=(
            "Also load the fixed demo user, balances, goals, statuses, and held "
            "cards. Use only for isolated local/eval databases; production "
            "bootstrap should clone the fixture per signed-in user."
        ),
    )
    args = parser.parse_args()

    sql = build_seed_sql(
        load_fixture(args.fixture),
        include_demo_persona=args.include_demo_persona,
    )
    if args.print_sql:
        print(sql, end="")
        return 0

    apply_seed(sql)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
