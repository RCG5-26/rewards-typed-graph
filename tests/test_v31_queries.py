import os
import shutil
import subprocess
import unittest
from unittest import mock
from pathlib import Path

from schema.queries import RedemptionPath, find_redemption_paths

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_SQL_PATH = REPO_ROOT / "schema" / "schema.sql"


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        self.connection.executed.append((sql, params or ()))

    def fetchall(self):
        return self.connection.rows


class FakeConnection:
    def __init__(self, rows):
        self.executed = []
        self.rows = rows

    def cursor(self):
        return FakeCursor(self)


class V31QueryHelperTest(unittest.TestCase):
    def test_find_redemption_paths_maps_rows_to_typed_results(self):
        connection = FakeConnection(
            [
                (
                    "00000000-0000-0000-0000-000000000100",
                    "00000000-0000-0000-0000-000000000101",
                    "00000000-0000-0000-0000-000000000103",
                    "00000000-0000-0000-0000-000000000201",
                    2,
                    10000,
                    21000,
                    3,
                    "Park Hyatt award night",
                )
            ]
        )

        paths = find_redemption_paths(
            connection,
            user_id="00000000-0000-0000-0000-000000000001",
            max_hops=2,
        )

        self.assertEqual(
            paths,
            [
                RedemptionPath(
                    source_balance_id="00000000-0000-0000-0000-000000000100",
                    source_program_id="00000000-0000-0000-0000-000000000101",
                    destination_program_id="00000000-0000-0000-0000-000000000103",
                    redemption_option_id="00000000-0000-0000-0000-000000000201",
                    hop_count=2,
                    effective_ratio_basis_points=10000,
                    cpp_basis_points=21000,
                    transfer_time_days=3,
                    description="Park Hyatt award night",
                )
            ],
        )
        self.assertIsInstance(paths[0].source_balance_id, str)
        self.assertIsInstance(paths[0].hop_count, int)
        self.assertIsInstance(paths[0].effective_ratio_basis_points, int)
        self.assertIsInstance(paths[0].cpp_basis_points, int)

    def test_find_redemption_paths_uses_parameterized_recursive_cte(self):
        user_id = "00000000-0000-0000-0000-000000000001"
        connection = FakeConnection([])

        find_redemption_paths(connection, user_id=user_id, max_hops=2)

        self.assertEqual(len(connection.executed), 1)
        sql, params = connection.executed[0]
        compact_sql = " ".join(sql.split())
        self.assertIn("WITH RECURSIVE", compact_sql)
        self.assertIn("transfers_to", compact_sql)
        self.assertIn("JOIN redeems_via", compact_sql)
        self.assertIn("user_balances.user_id = %s", compact_sql)
        self.assertNotIn(user_id, sql)
        self.assertEqual(params, (user_id, 2))

    def test_find_redemption_paths_uses_bigint_for_ratio_accumulation(self):
        connection = FakeConnection([])

        find_redemption_paths(
            connection,
            user_id="00000000-0000-0000-0000-000000000001",
            max_hops=2,
        )

        sql, _params = connection.executed[0]
        compact_sql = " ".join(sql.split())
        self.assertIn("10000::bigint AS effective_ratio_basis_points", compact_sql)
        self.assertIn("paths.effective_ratio_basis_points::bigint", compact_sql)
        self.assertIn("route.transfer_ratio_basis_points::bigint", compact_sql)
        self.assertIn("/ 10000::bigint AS effective_ratio_basis_points", compact_sql)
        self.assertNotIn("10000::integer AS effective_ratio_basis_points", compact_sql)

    def test_find_redemption_paths_rejects_excessive_max_hops(self):
        connection = FakeConnection([])

        with self.assertRaisesRegex(ValueError, "max_hops must be at most 4"):
            find_redemption_paths(
                connection,
                user_id="00000000-0000-0000-0000-000000000001",
                max_hops=5,
            )

        self.assertEqual(connection.executed, [])

    def test_live_postgres_setup_rejects_non_test_database_before_reset(self):
        original_environ = os.environ.copy()
        os.environ["RUN_LIVE_POSTGRES_TESTS"] = "1"
        os.environ["PGDATABASE"] = "rewards_prod"
        try:
            with mock.patch("tests.test_v31_queries.shutil.which", return_value="psql"):
                with mock.patch(
                    "tests.test_v31_queries._psql_exec",
                    side_effect=AssertionError("reset attempted"),
                ):
                    with self.assertRaisesRegex(
                        AssertionError,
                        "live Postgres tests require PGDATABASE to include 'test'",
                    ):
                        LiveV31QueryHelperTest(
                            "test_find_redemption_paths_returns_two_hop_live_route"
                        ).setUp()
        finally:
            os.environ.clear()
            os.environ.update(original_environ)


class LiveV31QueryHelperTest(unittest.TestCase):
    def setUp(self):
        if os.environ.get("RUN_LIVE_POSTGRES_TESTS") != "1":
            self.skipTest("set RUN_LIVE_POSTGRES_TESTS=1 to run live Postgres tests")
        if shutil.which("psql") is None:
            self.skipTest("psql is required for live Postgres tests")

        database_name = os.environ.get("PGDATABASE", "")
        if "test" not in database_name:
            self.fail("live Postgres tests require PGDATABASE to include 'test'")

        _psql_exec("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;")
        _psql_file(SCHEMA_SQL_PATH)
        _psql_exec(
            """
            INSERT INTO users (id, clerk_id, email, display_name)
            VALUES (
              '00000000-0000-0000-0000-000000000001',
              'clerk_rcg12',
              'rcg12@example.test',
              'RCG-12 User'
            );

            INSERT INTO reward_programs (
              id,
              slug,
              name,
              issuer,
              program_kind,
              currency_name
            )
            VALUES
              (
                '00000000-0000-0000-0000-000000000101',
                'ultimate-rewards',
                'Ultimate Rewards',
                'Chase',
                'issuer_transferable',
                'points'
              ),
              (
                '00000000-0000-0000-0000-000000000102',
                'airline-mid',
                'Airline Mid',
                'Airline',
                'airline',
                'miles'
              ),
              (
                '00000000-0000-0000-0000-000000000103',
                'hotel-dest',
                'Hotel Dest',
                'Hotel',
                'hotel',
                'points'
              );

            INSERT INTO user_balances (
              id,
              user_id,
              program_id,
              balance_points
            )
            VALUES (
              '00000000-0000-0000-0000-000000000100',
              '00000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000101',
              60000
            );

            INSERT INTO transfers_to (
              source_program_id,
              dest_program_id,
              transfer_ratio_basis_points,
              transfer_time_days,
              is_active
            )
            VALUES
              (
                '00000000-0000-0000-0000-000000000101',
                '00000000-0000-0000-0000-000000000102',
                10000,
                1,
                true
              ),
              (
                '00000000-0000-0000-0000-000000000102',
                '00000000-0000-0000-0000-000000000103',
                10000,
                2,
                true
              );

            INSERT INTO redemption_options (
              id,
              program_id,
              option_type,
              cpp_basis_points,
              min_points,
              description
            )
            VALUES (
              '00000000-0000-0000-0000-000000000201',
              '00000000-0000-0000-0000-000000000103',
              'transfer_partner',
              21000,
              30000,
              'Two-night hotel award'
            );

            INSERT INTO redeems_via (program_id, redemption_option_id)
            VALUES (
              '00000000-0000-0000-0000-000000000103',
              '00000000-0000-0000-0000-000000000201'
            );
            """
        )

    def test_find_redemption_paths_returns_two_hop_live_route(self):
        paths = find_redemption_paths(
            _PsqlConnection(),
            user_id="00000000-0000-0000-0000-000000000001",
            max_hops=2,
        )

        self.assertEqual(
            paths,
            [
                RedemptionPath(
                    source_balance_id="00000000-0000-0000-0000-000000000100",
                    source_program_id="00000000-0000-0000-0000-000000000101",
                    destination_program_id="00000000-0000-0000-0000-000000000103",
                    redemption_option_id="00000000-0000-0000-0000-000000000201",
                    hop_count=2,
                    effective_ratio_basis_points=10000,
                    cpp_basis_points=21000,
                    transfer_time_days=3,
                    description="Two-night hotel award",
                )
            ],
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

    def fetchall(self):
        return self.result


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
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"


def _psql_file(path):
    subprocess.run(
        ["psql", "--set", "ON_ERROR_STOP=1", "--file", str(path)],
        env=os.environ.copy(),
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _psql_exec(sql):
    subprocess.run(
        ["psql", "--set", "ON_ERROR_STOP=1"],
        input=sql,
        env=os.environ.copy(),
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def _psql_rows(sql):
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
