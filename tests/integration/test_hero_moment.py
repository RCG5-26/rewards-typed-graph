"""Hero Moment integration test — Jun 25 gate target.

This file is the shared acceptance target for RCG-28, RCG-29, and RCG-32.

Run (requires Postgres 16 + psql):
    RUN_LIVE_POSTGRES_TESTS=1 PGDATABASE=rewards_test \\
        python -m unittest tests.integration.test_hero_moment -v

Gate definition (hero green):
    1. Tokyo query → plan revision 1 (``current``) with >= 2 steps and >= 1 dependency
    2. ``transfer_points`` on a depended balance → prior plan becomes ``stale``
    3. Re-plan → revision 2 ``current``, revision 1 ``superseded``

Owner map:
    - Alan: ``fixtures/demo-seed.json`` + ``scripts/load_seed.py`` (RCG-8)
    - Raq: ``tests/integration/hero_flow.py`` orchestrator wiring (RCG-15/28/29)
    - Michael: redemption graph writer behind ``create_plan_from_query`` (RCG-21)
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import unittest
import uuid
from pathlib import Path

from schema.mutations import (
    CreatePlanRequest,
    CreatePlanStepRequest,
    RecordStateDependencyRequest,
    TransferPointsRequest,
    V31GraphWriteService,
)

from .hero_flow import (
    BalanceTransferSpec,
    create_plan_from_query,
    replan_after_balance_transfer,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_SQL_PATH = REPO_ROOT / "schema" / "schema.sql"
DEMO_SEED_PATH = REPO_ROOT / "fixtures" / "demo-seed.json"
LOAD_SEED_SCRIPT = REPO_ROOT / "scripts" / "load_seed.py"

# Stable IDs — align fixtures/demo-seed.json (RCG-8) with these or resolve by slug in load_seed.
DEMO_USER_ID = "00000000-0000-0000-0000-00000000a001"
CHASE_BALANCE_ID = "00000000-0000-0000-0000-00000000d001"
HYATT_BALANCE_ID = "00000000-0000-0000-0000-00000000d002"
HERO_QUERY = "What is the best Hyatt redemption for a 3-night Tokyo trip?"


class LivePostgresMixin:
    """Shared Postgres setup for integration tests."""

    def setUp(self):
        if os.environ.get("RUN_LIVE_POSTGRES_TESTS") != "1":
            self.skipTest("set RUN_LIVE_POSTGRES_TESTS=1 to run live Postgres tests")

        if shutil.which("psql") is None:
            self.skipTest("psql is required for live Postgres tests")

        database_name = os.environ.get("PGDATABASE", "")
        if not _is_safe_test_database_name(database_name):
            self.fail(
                "live Postgres tests require PGDATABASE to be a dedicated test database "
                "(exact name 'test', prefix 'test_', or suffix '_test'; "
                f"got {database_name!r})"
            )

        _psql_exec("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;")
        _psql_file(SCHEMA_SQL_PATH)
        self._load_demo_seed()

    def _load_demo_seed(self) -> None:
        """Prefer Alan's seed loader; fall back to inline Tokyo MVP rows."""
        if LOAD_SEED_SCRIPT.is_file() and DEMO_SEED_PATH.is_file():
            subprocess.run(
                [
                    sys.executable,
                    str(LOAD_SEED_SCRIPT),
                    str(DEMO_SEED_PATH),
                    "--include-demo-persona",
                ],
                env=os.environ.copy(),
                check=True,
                cwd=REPO_ROOT,
            )
            return

        # Inline fallback until RCG-8 lands — matches test_v31_mutations live fixture shape.
        _psql_exec(
            f"""
            INSERT INTO users (id, clerk_id, email)
            VALUES (
              '{DEMO_USER_ID}',
              'clerk_hero_demo',
              'hero-demo@example.com'
            );

            INSERT INTO reward_programs (
              id, slug, name, program_kind, currency_name
            )
            VALUES
              (
                '00000000-0000-0000-0000-00000000b001',
                'chase-ultimate-rewards',
                'Chase Ultimate Rewards',
                'issuer_transferable',
                'points'
              ),
              (
                '00000000-0000-0000-0000-00000000b002',
                'world-of-hyatt',
                'World of Hyatt',
                'hotel',
                'points'
              );

            INSERT INTO transfers_to (
              id, source_program_id, dest_program_id,
              transfer_ratio_basis_points, transfer_time_days
            )
            VALUES (
              '00000000-0000-0000-0000-00000000c001',
              '00000000-0000-0000-0000-00000000b001',
              '00000000-0000-0000-0000-00000000b002',
              10000,
              1
            );

            INSERT INTO user_balances (id, user_id, program_id, balance_points, version)
            VALUES
              (
                '{CHASE_BALANCE_ID}',
                '{DEMO_USER_ID}',
                '00000000-0000-0000-0000-00000000b001',
                240000,
                1
              ),
              (
                '{HYATT_BALANCE_ID}',
                '{DEMO_USER_ID}',
                '00000000-0000-0000-0000-00000000b002',
                0,
                1
              );
            """
        )


class HeroMomentDbPathTest(LivePostgresMixin, unittest.TestCase):
    """Partial gate — proves DB staleness path works before orchestrator lands."""

    def test_transfer_marks_dependent_plan_stale(self):
        """Beat 2 DB behavior: TransferPoints → plan + steps stale + replan_jobs row."""
        service = V31GraphWriteService(_PsqlConnection())
        plan_lineage_id = str(uuid.uuid4())

        plan_id = service.create_plan(
            CreatePlanRequest(
                actor="orchestrator",
                user_id=DEMO_USER_ID,
                plan_lineage_id=plan_lineage_id,
                revision_number=1,
                query_text=HERO_QUERY,
                status="current",
            )
        )

        step_id = service.create_plan_step(
            CreatePlanStepRequest(
                actor="redemption_agent",
                user_id=DEMO_USER_ID,
                plan_id=plan_id,
                plan_lineage_id=plan_lineage_id,
                revision_number=1,
                step_order=1,
                step_type="transfer_recommendation",
                payload={
                    "reasoning": "Transfer 60k UR to Hyatt for Tokyo award.",
                    "action": "transfer_points",
                },
                status="current",
            )
        )

        service.record_state_dependency(
            RecordStateDependencyRequest(
                actor="redemption_agent",
                user_id=DEMO_USER_ID,
                plan_step_id=step_id,
                target_node_id=CHASE_BALANCE_ID,
                target_node_type="UserBalance",
                target_table="user_balances",
                observed_version=1,
                snapshot_value={"balance_points": 240000},
                depended_property="balance_points",
            )
        )

        service.transfer_points(
            TransferPointsRequest(
                actor="wallet_agent",
                user_id=DEMO_USER_ID,
                source_balance_id=CHASE_BALANCE_ID,
                dest_balance_id=HYATT_BALANCE_ID,
                amount_points=60000,
                source_expected_version=1,
                dest_expected_version=1,
                idempotency_key="hero-moment-transfer-1",
                request_hash="hero-moment-transfer-hash-1",
            )
        )

        self.assertEqual(
            _psql_rows(
                f"""
                SELECT p.status, ps.status
                  FROM plans p
                  JOIN plan_steps ps ON ps.plan_id = p.id
                 WHERE p.id = '{plan_id}'
                """
            ),
            [("stale", "stale")],
        )
        self.assertGreaterEqual(
            _psql_rows("SELECT count(*) FROM replan_jobs")[0][0],
            1,
        )
        self.assertIn(
            ("TransferPoints",),
            _psql_rows(
                """
                SELECT DISTINCT mutation_type
                  FROM graph_mutations
                 ORDER BY mutation_type
                """
            ),
        )


class HeroMomentIntegrationTest(LivePostgresMixin, unittest.TestCase):
    """Full hero gate — green when hero_flow.py is wired."""

    def test_hero_end_to_end(self):
        connection = _PsqlConnection()

        plan_v1 = create_plan_from_query(
            connection,
            user_id=DEMO_USER_ID,
            query_text=HERO_QUERY,
        )

        self.assertEqual(plan_v1.status, "current")
        self.assertEqual(plan_v1.revision_number, 1)
        self.assertGreaterEqual(plan_v1.step_count, 2)
        self.assertGreaterEqual(plan_v1.dependency_count, 1)

        transfer = BalanceTransferSpec(
            actor="wallet_agent",
            user_id=DEMO_USER_ID,
            source_balance_id=CHASE_BALANCE_ID,
            dest_balance_id=HYATT_BALANCE_ID,
            amount_points=60000,
            source_expected_version=1,
            dest_expected_version=1,
            idempotency_key="hero-e2e-transfer",
            request_hash="hero-e2e-transfer-hash",
        )

        plan_v2 = replan_after_balance_transfer(
            connection,
            prior=plan_v1,
            transfer=transfer,
        )

        self.assertEqual(plan_v2.plan_lineage_id, plan_v1.plan_lineage_id)
        self.assertEqual(plan_v2.revision_number, 2)
        self.assertEqual(plan_v2.status, "current")

        prior_status = _psql_rows(
            f"""
            SELECT status FROM plans WHERE id = '{plan_v1.plan_id}'
            """
        )
        self.assertEqual(prior_status, [("superseded",)])

        self.assertEqual(
            _psql_rows(
                f"""
                SELECT status, result_plan_id
                  FROM replan_jobs
                 WHERE source_plan_id = '{plan_v1.plan_id}'
                """
            ),
            [("completed", plan_v2.plan_id)],
        )


class _PsqlConnection:
    def cursor(self):
        return _PsqlCursor()


class _PsqlCursor:
    def __init__(self):
        self.result = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self.result = _psql_rows(_format_psql_query(sql, params or ()))

    def fetchone(self):
        if not self.result:
            return None
        return self.result[0]


def _format_psql_query(sql, params):
    formatted = sql
    for param in params:
        formatted = formatted.replace("%s", _psql_literal(param), 1)
    return formatted


def _psql_literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, (dict, list)):
        # jsonb columns need valid JSON, not Python repr.
        escaped = json.dumps(value).replace("'", "''")
        return f"'{escaped}'"
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"


def _is_safe_test_database_name(name: str) -> bool:
    """Reject substring false positives like 'contest' before destructive DDL."""
    if not name:
        return False
    if name == "test":
        return True
    return name.endswith("_test") or name.startswith("test_")


def _psql_file(path: Path) -> None:
    subprocess.run(
        ["psql", "--set", "ON_ERROR_STOP=1", "--file", str(path)],
        env=os.environ.copy(),
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _psql_exec(sql: str) -> None:
    subprocess.run(
        ["psql", "--set", "ON_ERROR_STOP=1"],
        input=sql,
        env=os.environ.copy(),
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _psql_rows(sql: str):
    result = subprocess.run(
        [
            "psql",
            "--set",
            "ON_ERROR_STOP=1",
            "--no-align",
            "--tuples-only",
            "--field-separator",
            "\x1f",
            "--record-separator",
            "\x1e",
        ],
        input=sql,
        env=os.environ.copy(),
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    output = result.stdout.strip("\n\x1e")
    if not output:
        return []
    return [
        tuple(_parse_psql_value(value) for value in row.split("\x1f"))
        for row in output.split("\x1e")
        if row
    ]


def _parse_psql_value(value):
    if value == "":
        return None
    if value == "t":
        return True
    if value == "f":
        return False
    if value.lstrip("-").isdigit():
        return int(value)
    return value


if __name__ == "__main__":
    unittest.main()
