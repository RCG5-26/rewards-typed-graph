import importlib.util
import json
import os
import pathlib
import shutil
import subprocess
import unittest
import uuid


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
DEMO_SEED_PATH = REPO_ROOT / "fixtures" / "demo-seed.json"
LOAD_SEED_PATH = REPO_ROOT / "scripts" / "load_seed.py"
SCHEMA_SQL_PATH = REPO_ROOT / "schema" / "schema.sql"

DEMO_USER_ID = "00000000-0000-0000-0000-00000000a001"
CHASE_PROGRAM_ID = "00000000-0000-0000-0000-00000000b001"
HYATT_PROGRAM_ID = "00000000-0000-0000-0000-00000000b002"
UNITED_PROGRAM_ID = "00000000-0000-0000-0000-00000000b003"
CHASE_BALANCE_ID = "00000000-0000-0000-0000-00000000d001"
HYATT_BALANCE_ID = "00000000-0000-0000-0000-00000000d002"
TOKYO_GOAL_ID = "00000000-0000-0000-0000-00000000d301"


class DemoSeedFixtureTest(unittest.TestCase):
    def setUp(self):
        self.fixture = json.loads(DEMO_SEED_PATH.read_text(encoding="utf-8"))

    def test_fixture_locks_required_counts_and_point_total(self):
        self.assertEqual(self.fixture["fixture_id"], "demo-seed-v1")
        self.assertEqual(len(self.fixture["credit_cards"]), 5)
        self.assertEqual(len(self.fixture["reward_programs"]), 3)
        self.assertEqual(len(self.fixture["user_balances"]), 3)
        self.assertEqual(
            sum(balance["balance_points"] for balance in self.fixture["user_balances"]),
            240000,
        )
        self.assertEqual(len(self.fixture["holds"]), 5)

    def test_fixture_uses_stable_ids_and_expected_slugs(self):
        all_ids = [
            row["id"]
            for fixture_key in (
                "users",
                "reward_programs",
                "credit_cards",
                "spend_categories",
                "transfers_to",
                "redemption_options",
                "redeems_via",
                "user_balances",
                "user_program_statuses",
                "user_goals",
                "holds",
                "earns",
            )
            for row in self.fixture[fixture_key]
        ]
        self.assertEqual(len(all_ids), len(set(all_ids)))
        for stable_id in all_ids:
            uuid.UUID(stable_id)

        self.assertEqual(self.fixture["users"][0]["id"], DEMO_USER_ID)
        self.assertEqual(
            {program["slug"] for program in self.fixture["reward_programs"]},
            {"program:chase_ur", "program:hyatt", "program:united"},
        )
        self.assertEqual(
            {card["slug"] for card in self.fixture["credit_cards"]},
            {
                "card:chase_sapphire_reserve",
                "card:chase_sapphire_preferred",
                "card:chase_freedom_unlimited",
                "card:world_of_hyatt",
                "card:united_explorer",
            },
        )

    def test_fixture_supports_hero_transfer_path(self):
        balances = {balance["id"]: balance for balance in self.fixture["user_balances"]}
        self.assertEqual(balances[CHASE_BALANCE_ID]["program_id"], CHASE_PROGRAM_ID)
        self.assertEqual(balances[HYATT_BALANCE_ID]["program_id"], HYATT_PROGRAM_ID)
        self.assertEqual(balances[CHASE_BALANCE_ID]["version"], 1)
        self.assertEqual(balances[HYATT_BALANCE_ID]["version"], 1)

        transfers = {
            (transfer["source_program_id"], transfer["dest_program_id"]): transfer
            for transfer in self.fixture["transfers_to"]
        }
        self.assertEqual(
            transfers[(CHASE_PROGRAM_ID, HYATT_PROGRAM_ID)]["transfer_ratio_basis_points"],
            10000,
        )
        self.assertEqual(
            transfers[(CHASE_PROGRAM_ID, UNITED_PROGRAM_ID)]["transfer_ratio_basis_points"],
            10000,
        )

    def test_fixture_locks_tokyo_october_goal(self):
        goals = {goal["id"]: goal for goal in self.fixture["user_goals"]}
        goal = goals[TOKYO_GOAL_ID]

        self.assertEqual(goal["user_id"], DEMO_USER_ID)
        self.assertEqual(goal["goal_type"], "specific_redemption")
        self.assertEqual(goal["target_program_id"], HYATT_PROGRAM_ID)
        self.assertEqual(goal["target_location"], "Tokyo")
        self.assertEqual(goal["target_date"], "2026-10-15")
        self.assertEqual(goal["payload"]["nights"], 3)
        self.assertEqual(goal["payload"]["preferred_program_slug"], "program:hyatt")

    def test_loader_default_table_specs_are_shared_world_seed_only(self):
        loader = _load_seed_module()
        default_tables = {table_name for _, table_name, _, _ in loader.WORLD_TABLE_SPECS}

        self.assertGreaterEqual(
            default_tables,
            {
                "reward_programs",
                "credit_cards",
                "spend_categories",
                "transfers_to",
                "redemption_options",
                "redeems_via",
                "earns",
            },
        )
        self.assertFalse(
            {
                "users",
                "user_balances",
                "user_program_statuses",
                "user_goals",
                "holds",
            }
            & default_tables
        )

    def test_loader_generates_idempotent_sql_without_generated_ids(self):
        loader = _load_seed_module()
        sql = loader.build_seed_sql(self.fixture)

        self.assertIn("ON CONFLICT (id) DO UPDATE", sql)
        self.assertNotIn("gen_random_uuid()", sql)
        self.assertNotIn("mcc_codes = EXCLUDED.mcc_codes::jsonb", sql)
        self.assertIn("ARRAY[3000, 3351, 3501, 4511, 4722]", sql)

    def test_loader_can_include_demo_persona_for_isolated_tests(self):
        loader = _load_seed_module()
        sql = loader.build_seed_sql(self.fixture, include_demo_persona=True)

        self.assertIn("INSERT INTO users", sql)
        self.assertIn("INSERT INTO user_balances", sql)
        self.assertIn("INSERT INTO user_goals", sql)
        self.assertIn(DEMO_USER_ID, sql)
        self.assertIn(CHASE_BALANCE_ID, sql)
        self.assertIn(HYATT_BALANCE_ID, sql)


class DemoSeedFixtureLivePostgresTest(unittest.TestCase):
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

    def test_default_seed_applies_without_personal_demo_rows(self):
        sql = _load_seed_module().build_seed_sql(
            json.loads(DEMO_SEED_PATH.read_text(encoding="utf-8"))
        )
        _psql_exec(sql)
        _psql_exec(sql)

        self.assertEqual(
            _psql_rows(
                """
                SELECT
                  (SELECT count(*) FROM credit_cards),
                  (SELECT count(*) FROM reward_programs),
                  (SELECT count(*) FROM transfers_to),
                  (SELECT count(*) FROM users),
                  (SELECT count(*) FROM user_balances),
                  (SELECT count(*) FROM user_goals)
                """
            ),
            [(5, 3, 2, 0, 0, 0)],
        )

    def test_seed_applies_idempotently_and_preserves_demo_wallet(self):
        sql = _load_seed_module().build_seed_sql(
            json.loads(DEMO_SEED_PATH.read_text(encoding="utf-8")),
            include_demo_persona=True,
        )
        _psql_exec(sql)
        _psql_exec(sql)

        self.assertEqual(
            _psql_rows(
                """
                SELECT
                  (SELECT count(*) FROM credit_cards),
                  (SELECT count(*) FROM reward_programs),
                  (SELECT count(*) FROM user_balances),
                  (SELECT coalesce(sum(balance_points), 0) FROM user_balances),
                  (SELECT count(*) FROM holds)
                """
            ),
            [(5, 3, 3, 240000, 5)],
        )
        self.assertEqual(
            _psql_rows(
                f"""
                SELECT transfer_ratio_basis_points
                  FROM transfers_to
                 WHERE source_program_id = '{CHASE_PROGRAM_ID}'
                   AND dest_program_id = '{HYATT_PROGRAM_ID}'
                """
            ),
            [(10000,)],
        )


def _load_seed_module():
    spec = importlib.util.spec_from_file_location("load_seed", LOAD_SEED_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _is_safe_test_database_name(name: str) -> bool:
    if not name:
        return False
    if name == "test":
        return True
    return name.endswith("_test") or name.startswith("test_")


def _psql_file(path: pathlib.Path) -> None:
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
