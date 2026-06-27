import importlib.util
import io
import json
import pathlib
import subprocess
import unittest
from unittest import mock


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BOOTSTRAP_PATH = REPO_ROOT / "scripts" / "ensure_schema_seed.py"
DEMO_SEED_PATH = REPO_ROOT / "fixtures" / "demo-seed.json"
SCHEMA_SQL_PATH = REPO_ROOT / "schema" / "schema.sql"
DOCKERFILE_PATH = REPO_ROOT / "Dockerfile"
DEV_DB_SETUP_PATH = REPO_ROOT / "scripts" / "dev-db-setup.sh"


class FakePsqlGateway:
    def __init__(
        self,
        existing_tables: set[str],
        existing_functions: set[str] | None = None,
    ) -> None:
        self._existing_tables = existing_tables
        self._existing_functions = (
            existing_functions if existing_functions is not None else set()
        )
        self.applied_schema_paths: list[pathlib.Path] = []
        self.executed_sql: list[str] = []
        self.seed_applied = False

    def existing_tables(self) -> set[str]:
        return self._existing_tables

    def existing_functions(self) -> set[str]:
        return self._existing_functions

    def apply_schema_file(self, path: pathlib.Path) -> None:
        self.applied_schema_paths.append(path)

    def execute(self, sql: str) -> None:
        self.executed_sql.append(sql)
        self.seed_applied = True

    def count_rows_by_ids(self, table_name: str, ids: list[str]) -> int:
        return len(ids) if self.seed_applied else 0


class SchemaSeedBootstrapTests(unittest.TestCase):
    def setUp(self) -> None:
        self.bootstrap = _load_bootstrap_module()
        self.fixture = json.loads(DEMO_SEED_PATH.read_text(encoding="utf-8"))

    def test_empty_database_applies_schema_then_seed_with_demo_persona(self) -> None:
        fake = FakePsqlGateway(existing_tables=set())

        summary = self.bootstrap.ensure_schema_and_seed(
            schema_path=SCHEMA_SQL_PATH,
            fixture_path=DEMO_SEED_PATH,
            include_demo_persona=True,
            psql=fake,
        )

        self.assertEqual(summary["schema"], "applied")
        self.assertEqual(fake.applied_schema_paths, [SCHEMA_SQL_PATH])
        self.assertEqual(len(fake.executed_sql), 1)
        self.assertIn("INSERT INTO users", fake.executed_sql[0])
        self.assertEqual(summary["verified"]["reward_programs"], 3)
        self.assertEqual(summary["verified"]["user_balances"], 3)

    def test_existing_complete_schema_skips_schema_and_still_seeds(self) -> None:
        fake = FakePsqlGateway(
            existing_tables=set(self.bootstrap.REQUIRED_SCHEMA_TABLES),
            existing_functions=set(self.bootstrap.REQUIRED_SCHEMA_FUNCTIONS),
        )

        summary = self.bootstrap.ensure_schema_and_seed(
            schema_path=SCHEMA_SQL_PATH,
            fixture_path=DEMO_SEED_PATH,
            include_demo_persona=False,
            psql=fake,
        )

        self.assertEqual(summary["schema"], "already_present")
        self.assertEqual(fake.applied_schema_paths, [])
        self.assertEqual(len(fake.executed_sql), 1)
        self.assertIn("INSERT INTO reward_programs", fake.executed_sql[0])
        self.assertNotIn("INSERT INTO users", fake.executed_sql[0])
        self.assertEqual(summary["verified"]["credit_cards"], 5)
        self.assertNotIn("user_balances", summary["verified"])

    def test_partial_schema_fails_before_seed_write(self) -> None:
        fake = FakePsqlGateway(existing_tables={"users"})

        with self.assertRaisesRegex(
            self.bootstrap.SchemaSeedError,
            "database is not empty but is missing required schema tables",
        ):
            self.bootstrap.ensure_schema_and_seed(
                schema_path=SCHEMA_SQL_PATH,
                fixture_path=DEMO_SEED_PATH,
                include_demo_persona=True,
                psql=fake,
            )

        self.assertEqual(fake.applied_schema_paths, [])
        self.assertEqual(fake.executed_sql, [])

    def test_functions_without_tables_fail_before_schema_or_seed_write(self) -> None:
        fake = FakePsqlGateway(
            existing_tables=set(),
            existing_functions={"transfer_points"},
        )

        with self.assertRaisesRegex(
            self.bootstrap.SchemaSeedError,
            "database is not empty but is missing required schema tables",
        ):
            self.bootstrap.ensure_schema_and_seed(
                schema_path=SCHEMA_SQL_PATH,
                fixture_path=DEMO_SEED_PATH,
                include_demo_persona=True,
                psql=fake,
            )

        self.assertEqual(fake.applied_schema_paths, [])
        self.assertEqual(fake.executed_sql, [])

    def test_schema_missing_required_functions_fails_before_seed_write(self) -> None:
        fake = FakePsqlGateway(
            existing_tables=set(self.bootstrap.REQUIRED_SCHEMA_TABLES),
            existing_functions={"transfer_points"},
        )

        with self.assertRaisesRegex(
            self.bootstrap.SchemaSeedError,
            "database schema is missing required functions",
        ):
            self.bootstrap.ensure_schema_and_seed(
                schema_path=SCHEMA_SQL_PATH,
                fixture_path=DEMO_SEED_PATH,
                include_demo_persona=True,
                psql=fake,
            )

        self.assertEqual(fake.applied_schema_paths, [])
        self.assertEqual(fake.executed_sql, [])

    def test_docker_api_startup_runs_schema_seed_before_server(self) -> None:
        dockerfile = DOCKERFILE_PATH.read_text(encoding="utf-8")

        self.assertIn("scripts/ensure_schema_seed.py --include-demo-persona", dockerfile)
        self.assertIn('${PYTHON_BIN:-python3}', dockerfile)
        self.assertIn("exec npm --prefix apps/api run start", dockerfile)

    def test_local_setup_uses_same_schema_seed_bootstrap(self) -> None:
        setup_script = DEV_DB_SETUP_PATH.read_text(encoding="utf-8")

        self.assertIn("scripts/ensure_schema_seed.py --include-demo-persona", setup_script)
        self.assertIn('${PYTHON_BIN:-python3}', setup_script)

    def test_cli_prints_json_summary_and_returns_zero(self) -> None:
        summary = {
            "schema": "already_present",
            "seed": "applied",
            "include_demo_persona": True,
            "verified": {"reward_programs": 3},
        }
        stdout = io.StringIO()

        with (
            mock.patch.object(
                self.bootstrap.sys,
                "argv",
                [
                    "ensure_schema_seed.py",
                    "--schema",
                    str(SCHEMA_SQL_PATH),
                    "--fixture",
                    str(DEMO_SEED_PATH),
                    "--include-demo-persona",
                ],
            ),
            mock.patch.object(
                self.bootstrap, "ensure_schema_and_seed", return_value=summary
            ) as ensure_seed,
            mock.patch.object(self.bootstrap.sys, "stdout", stdout),
        ):
            result = self.bootstrap.main()

        self.assertEqual(result, 0)
        ensure_seed.assert_called_once_with(
            schema_path=SCHEMA_SQL_PATH,
            fixture_path=DEMO_SEED_PATH,
            include_demo_persona=True,
        )
        self.assertEqual(json.loads(stdout.getvalue()), summary)

    def test_cli_returns_two_when_bootstrap_fails(self) -> None:
        stderr = io.StringIO()

        with (
            mock.patch.object(self.bootstrap.sys, "argv", ["ensure_schema_seed.py"]),
            mock.patch.object(
                self.bootstrap,
                "ensure_schema_and_seed",
                side_effect=self.bootstrap.SchemaSeedError("missing tables"),
            ),
            mock.patch.object(self.bootstrap.sys, "stderr", stderr),
        ):
            result = self.bootstrap.main()

        self.assertEqual(result, 2)
        self.assertIn("schema/seed bootstrap failed: missing tables", stderr.getvalue())

    def test_subprocess_gateway_requires_psql(self) -> None:
        gateway = self.bootstrap.SubprocessPsqlGateway(env={"DATABASE_URL": "postgres://db"})

        with (
            mock.patch.object(
                self.bootstrap.subprocess, "run", side_effect=FileNotFoundError
            ),
            self.assertRaisesRegex(
                self.bootstrap.SchemaSeedError,
                "psql is required to ensure schema and seed data",
            ),
        ):
            gateway.existing_tables()

    def test_subprocess_gateway_requires_database_url_before_psql(self) -> None:
        gateway = self.bootstrap.SubprocessPsqlGateway(env={})

        with (
            mock.patch.object(self.bootstrap.subprocess, "run") as run,
            self.assertRaisesRegex(
                self.bootstrap.SchemaSeedError,
                "DATABASE_URL is required to ensure schema and seed data",
            ),
        ):
            gateway.existing_tables()

        run.assert_not_called()

    def test_subprocess_gateway_surfaces_psql_stderr(self) -> None:
        gateway = self.bootstrap.SubprocessPsqlGateway(env={"DATABASE_URL": "postgres://db"})
        error = subprocess.CalledProcessError(
            1,
            ["psql"],
            stderr="relation does not exist",
        )

        with (
            mock.patch.object(self.bootstrap.subprocess, "run", side_effect=error),
            self.assertRaisesRegex(
                self.bootstrap.SchemaSeedError,
                "relation does not exist",
            ),
        ):
            gateway.execute("SELECT 1")

    def test_subprocess_gateway_parses_rows_and_counts_seed_ids(self) -> None:
        gateway = self.bootstrap.SubprocessPsqlGateway(
            env={"DATABASE_URL": "postgres://db"}
        )
        calls: list[list[str]] = []

        def fake_run(command, **kwargs):
            calls.append(command)
            self.assertEqual(kwargs["env"], {"DATABASE_URL": "postgres://db"})
            self.assertEqual(kwargs["timeout"], self.bootstrap.PSQL_TIMEOUT_SECONDS)
            if "information_schema.tables" in (kwargs.get("input") or ""):
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout="users\x1ereward_programs\x1e",
                    stderr="",
                )
            if "information_schema.routines" in (kwargs.get("input") or ""):
                return subprocess.CompletedProcess(
                    command,
                    0,
                    stdout="transfer_points\x1e",
                    stderr="",
                )
            return subprocess.CompletedProcess(command, 0, stdout="2\x1e", stderr="")

        with mock.patch.object(self.bootstrap.subprocess, "run", side_effect=fake_run):
            self.assertEqual(gateway.existing_tables(), {"users", "reward_programs"})
            self.assertEqual(gateway.existing_functions(), {"transfer_points"})
            self.assertEqual(
                gateway.count_rows_by_ids("users", ["person-c", "o'hare"]),
                2,
            )
            gateway.apply_schema_file(SCHEMA_SQL_PATH)

        self.assertTrue(
            all(
                command[:4] == ["psql", "--set", "ON_ERROR_STOP=1", "--quiet"]
                for command in calls
            )
        )
        self.assertTrue(all(command[-1] == "postgres://db" for command in calls))

    def test_subprocess_gateway_rejects_unknown_seed_table_verification(self) -> None:
        gateway = self.bootstrap.SubprocessPsqlGateway(env={})

        with self.assertRaisesRegex(
            self.bootstrap.SchemaSeedError,
            "cannot verify unknown seed table",
        ):
            gateway.count_rows_by_ids("not_a_seed_table", ["id"])

    def test_psql_value_parser_handles_common_scalar_types(self) -> None:
        self.assertIsNone(self.bootstrap._parse_psql_value(""))
        self.assertIs(self.bootstrap._parse_psql_value("t"), True)
        self.assertIs(self.bootstrap._parse_psql_value("f"), False)
        self.assertEqual(self.bootstrap._parse_psql_value("-7"), -7)
        self.assertEqual(self.bootstrap._parse_psql_value("person-c"), "person-c")


def _load_bootstrap_module():
    spec = importlib.util.spec_from_file_location("ensure_schema_seed", BOOTSTRAP_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec is not None
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


if __name__ == "__main__":
    unittest.main()
