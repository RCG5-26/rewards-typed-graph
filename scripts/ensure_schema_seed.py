"""Ensure a database has the canonical schema and demo seed data.

This is intentionally non-destructive:

* an empty public schema gets ``schema/schema.sql`` applied;
* an existing complete schema is left in place and receives idempotent seed rows;
* a partial schema fails loudly instead of trying to guess a migration path.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Protocol


SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from load_seed import build_seed_sql, load_fixture  # noqa: E402


DEFAULT_SCHEMA_PATH = ROOT / "schema" / "schema.sql"
DEFAULT_FIXTURE_PATH = ROOT / "fixtures" / "demo-seed.json"
PSQL_TIMEOUT_SECONDS = 45

REQUIRED_SCHEMA_TABLES = (
    "users",
    "reward_programs",
    "credit_cards",
    "spend_categories",
    "redemption_options",
    "transfers_to",
    "user_balances",
    "user_program_statuses",
    "user_goals",
    "holds",
    "earns",
    "redeems_via",
    "plans",
    "plan_steps",
    "state_dependencies",
    "graph_mutations",
    "replan_jobs",
    "idempotency_records",
)

REQUIRED_SCHEMA_FUNCTIONS = (
    "claim_replan_jobs",
    "mark_direct_plan_dependents_stale",
    "promote_replan_job_success",
    "transfer_points",
)

WORLD_SEED_TABLES = (
    "reward_programs",
    "credit_cards",
    "spend_categories",
    "transfers_to",
    "redemption_options",
    "redeems_via",
    "earns",
)

DEMO_PERSONA_SEED_TABLES = (
    "users",
    "user_balances",
    "user_program_statuses",
    "user_goals",
    "holds",
)

KNOWN_SEED_TABLES = set(WORLD_SEED_TABLES + DEMO_PERSONA_SEED_TABLES)


class SchemaSeedError(RuntimeError):
    """Raised when schema or seed bootstrap cannot safely continue."""


class PsqlGateway(Protocol):
    def existing_tables(self) -> set[str]: ...

    def existing_functions(self) -> set[str]: ...

    def apply_schema_file(self, path: Path) -> None: ...

    def execute(self, sql: str) -> None: ...

    def count_rows_by_ids(self, table_name: str, ids: list[str]) -> int: ...


class SubprocessPsqlGateway:
    """psql-backed gateway used by the CLI and API container startup."""

    def __init__(
        self,
        *,
        env: dict[str, str] | None = None,
        timeout_seconds: int = PSQL_TIMEOUT_SECONDS,
    ) -> None:
        self.env = env or os.environ.copy()
        self.timeout_seconds = timeout_seconds

    def existing_tables(self) -> set[str]:
        rows = self._rows(
            """
            SELECT table_name
              FROM information_schema.tables
             WHERE table_schema = 'public'
               AND table_type = 'BASE TABLE'
             ORDER BY table_name
            """
        )
        return {str(row[0]) for row in rows}

    def existing_functions(self) -> set[str]:
        rows = self._rows(
            """
            SELECT routine_name
              FROM information_schema.routines
             WHERE specific_schema = 'public'
               AND routine_type = 'FUNCTION'
             ORDER BY routine_name
            """
        )
        return {str(row[0]) for row in rows}

    def apply_schema_file(self, path: Path) -> None:
        self._run(["--file", str(path)])

    def execute(self, sql: str) -> None:
        self._run([], input_text=sql)

    def count_rows_by_ids(self, table_name: str, ids: list[str]) -> int:
        if table_name not in KNOWN_SEED_TABLES:
            raise SchemaSeedError(f"cannot verify unknown seed table {table_name!r}")
        if not ids:
            return 0
        id_list = ", ".join(_quote_sql(value) for value in ids)
        rows = self._rows(
            f"SELECT count(*) FROM {table_name} WHERE id IN ({id_list})"
        )
        return int(rows[0][0]) if rows else 0

    def _rows(self, sql: str) -> list[tuple[Any, ...]]:
        result = self._run(
            [
                "--no-align",
                "--tuples-only",
                "--field-separator",
                "\x1f",
                "--record-separator",
                "\x1e",
            ],
            input_text=sql,
            capture=True,
        )
        output = result.stdout.strip("\n\x1e")
        if not output:
            return []
        return [
            tuple(_parse_psql_value(value) for value in row.split("\x1f"))
            for row in output.split("\x1e")
            if row
        ]

    def _run(
        self,
        args: list[str],
        *,
        input_text: str | None = None,
        capture: bool = False,
    ) -> subprocess.CompletedProcess[str]:
        database_url = self.env.get("DATABASE_URL")
        if not database_url:
            raise SchemaSeedError(
                "DATABASE_URL is required to ensure schema and seed data"
            )
        command = ["psql", "--set", "ON_ERROR_STOP=1", "--quiet", *args, database_url]
        try:
            return subprocess.run(
                command,
                input=input_text,
                check=True,
                text=True,
                env=self.env,
                timeout=self.timeout_seconds,
                stdout=subprocess.PIPE if capture else None,
                stderr=subprocess.PIPE if capture else None,
            )
        except FileNotFoundError as error:
            raise SchemaSeedError("psql is required to ensure schema and seed data") from error
        except subprocess.CalledProcessError as error:
            detail = (error.stderr or "").strip()
            if detail:
                raise SchemaSeedError(detail) from error
            raise SchemaSeedError(str(error)) from error


def ensure_schema_and_seed(
    *,
    schema_path: str | Path = DEFAULT_SCHEMA_PATH,
    fixture_path: str | Path = DEFAULT_FIXTURE_PATH,
    include_demo_persona: bool = False,
    psql: PsqlGateway | None = None,
) -> dict[str, Any]:
    """Apply schema only for an empty database, then load and verify seed rows."""

    schema = Path(schema_path)
    fixture = load_fixture(Path(fixture_path))
    gateway = psql or SubprocessPsqlGateway()

    existing_tables = gateway.existing_tables()
    existing_functions = gateway.existing_functions()
    schema_status = "already_present"
    if not existing_tables and not existing_functions:
        gateway.apply_schema_file(schema)
        schema_status = "applied"
    else:
        missing = sorted(set(REQUIRED_SCHEMA_TABLES) - existing_tables)
        if missing:
            raise SchemaSeedError(
                "database is not empty but is missing required schema tables: "
                + ", ".join(missing)
            )
        missing_functions = sorted(set(REQUIRED_SCHEMA_FUNCTIONS) - existing_functions)
        if missing_functions:
            raise SchemaSeedError(
                "database schema is missing required functions: "
                + ", ".join(missing_functions)
            )

    gateway.execute(
        build_seed_sql(fixture, include_demo_persona=include_demo_persona)
    )
    verified = _verify_seed_rows(
        fixture,
        include_demo_persona=include_demo_persona,
        psql=gateway,
    )
    return {
        "schema": schema_status,
        "seed": "applied",
        "include_demo_persona": include_demo_persona,
        "verified": verified,
    }


def _verify_seed_rows(
    fixture: dict[str, Any],
    *,
    include_demo_persona: bool,
    psql: PsqlGateway,
) -> dict[str, int]:
    tables = list(WORLD_SEED_TABLES)
    if include_demo_persona:
        tables.extend(DEMO_PERSONA_SEED_TABLES)

    verified: dict[str, int] = {}
    for table in tables:
        ids = [str(row["id"]) for row in fixture.get(table, [])]
        if not ids:
            continue
        actual = psql.count_rows_by_ids(table, ids)
        expected = len(ids)
        if actual != expected:
            raise SchemaSeedError(
                f"seed verification failed for {table}: expected {expected}, found {actual}"
            )
        verified[table] = actual
    return verified


def _quote_sql(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _parse_psql_value(value: str) -> Any:
    if value == "":
        return None
    if value == "t":
        return True
    if value == "f":
        return False
    if value.lstrip("-").isdigit():
        return int(value)
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--schema", type=Path, default=DEFAULT_SCHEMA_PATH)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE_PATH)
    parser.add_argument(
        "--include-demo-persona",
        action="store_true",
        help="Also ensure the fixed local/demo persona rows are present.",
    )
    args = parser.parse_args()

    try:
        summary = ensure_schema_and_seed(
            schema_path=args.schema,
            fixture_path=args.fixture,
            include_demo_persona=args.include_demo_persona,
        )
    except SchemaSeedError as error:
        print(f"schema/seed bootstrap failed: {error}", file=sys.stderr)
        return 2

    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
