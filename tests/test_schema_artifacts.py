import json
import os
import pathlib
import shutil
import subprocess
import sys
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_SQL_PATH = REPO_ROOT / "schema" / "schema.sql"
SCHEMA_CONTRACT_PATH = REPO_ROOT / "schema" / "contracts" / "graph.schema.json"
GENERATED_PYTHON_TYPES_PATH = REPO_ROOT / "schema" / "generated" / "types.py"
GENERATED_TYPESCRIPT_TYPES_PATH = REPO_ROOT / "schema" / "generated" / "types.ts"
GENERATE_SCHEMA_TYPES_PATH = REPO_ROOT / "scripts" / "generate_schema_types.py"
EXPERIMENTAL_DIR = REPO_ROOT / "schema" / "experimental" / "polymorphic"


class SchemaArtifactsTest(unittest.TestCase):
    def test_schema_contract_is_v31_source_for_generated_types(self):
        contract = json.loads(SCHEMA_CONTRACT_PATH.read_text(encoding="utf-8"))

        self.assertEqual(contract["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertEqual(contract["title"], "Rewards Typed Graph v3.1 Contract")
        self.assertEqual(
            tuple(contract["$defs"]["nodeTypes"]["enum"]),
            (
                "User",
                "CreditCard",
                "RewardProgram",
                "SpendCategory",
                "RedemptionOption",
                "ExternalQuote",
                "UserBalance",
                "UserProgramStatus",
                "UserGoal",
                "Plan",
                "PlanStep",
                "AgentRun",
            ),
        )
        self.assertEqual(
            tuple(contract["x-graph"]["planStatuses"]),
            ("generating", "current", "stale", "failed", "superseded"),
        )
        self.assertEqual(contract["x-graph"]["nodeTiers"]["UserBalance"], "personal")
        self.assertEqual(
            contract["x-graph"]["edgeTypeRules"]["DEPENDS_ON"],
            {"source": "PlanStep", "target": None},
        )
        self.assertTrue(GENERATED_PYTHON_TYPES_PATH.exists())
        self.assertTrue(GENERATED_TYPESCRIPT_TYPES_PATH.exists())

    def test_generated_schema_types_are_up_to_date(self):
        result = subprocess.run(
            [
                sys.executable,
                str(GENERATE_SCHEMA_TYPES_PATH),
                "--check",
            ],
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(
            result.returncode,
            0,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )

    def test_python_schema_exports_v31_enums_and_validation(self):
        from schema import types

        self.assertIn("CreditCard", types.NODE_TYPES)
        self.assertIn("RewardProgram", types.NODE_TYPES)
        self.assertIn("Plan", types.NODE_TYPES)
        self.assertIn("PlanStep", types.NODE_TYPES)
        self.assertNotIn("PlanQuery", types.NODE_TYPES)
        self.assertNotIn("Balance", types.NODE_TYPES)
        self.assertEqual(types.GRAPH_TIERS, ("world", "personal", "plan"))

        valid_balance = types.GraphNode(
            type="UserBalance",
            tier="personal",
            attributes={
                "user_id": "00000000-0000-0000-0000-000000000001",
                "program_id": "00000000-0000-0000-0000-000000000002",
                "balance_points": 240000,
            },
        )
        bad_plan = types.GraphNode(
            type="Plan",
            tier="plan",
            attributes={
                "plan_lineage_id": "00000000-0000-0000-0000-000000000003",
                "revision_number": 1,
                "query_text": "Find the best Tokyo redemption.",
                "status": "active",
            },
        )

        self.assertEqual(types.validate_node(valid_balance), [])
        self.assertEqual(
            types.validate_node(bad_plan),
            [
                "Plan.attributes.status must be one of "
                "('generating', 'current', 'stale', 'failed', 'superseded')"
            ],
        )

    def test_edge_validation_enforces_v31_source_and_target_types(self):
        from schema import types

        valid_edge = types.GraphEdge(
            type="TRANSFERS_TO",
            source_type="RewardProgram",
            target_type="RewardProgram",
            attributes={
                "transfer_ratio_basis_points": 10000,
                "is_active": True,
            },
        )
        invalid_edge = types.GraphEdge(
            type="TRANSFERS_TO",
            source_type="CreditCard",
            target_type="RewardProgram",
            attributes={
                "transfer_ratio_basis_points": 10000,
                "is_active": True,
            },
        )

        self.assertEqual(types.validate_edge(valid_edge), [])
        self.assertEqual(
            types.validate_edge(invalid_edge),
            ["TRANSFERS_TO edge source must be RewardProgram, got CreditCard"],
        )

    def test_default_schema_sql_contains_v31_tables_constraints_and_indexes(self):
        schema_sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")

        for table_name in (
            "users",
            "credit_cards",
            "reward_programs",
            "user_balances",
            "plans",
            "plan_steps",
            "state_dependencies",
            "graph_mutations",
            "replan_jobs",
            "idempotency_records",
            "evaluations",
        ):
            self.assertIn(f"CREATE TABLE {table_name}", schema_sql)

        self.assertIn("clerk_id TEXT NOT NULL UNIQUE", schema_sql)
        self.assertIn("CREATE UNIQUE INDEX plans_one_current_revision", schema_sql)
        self.assertIn("WHERE status = 'current'", schema_sql)
        self.assertNotIn("CREATE TABLE nodes", schema_sql)
        self.assertNotIn("CREATE TABLE edges", schema_sql)
        self.assertNotIn("is_current", schema_sql)
        self.assertNotIn("is_stale", schema_sql)

    def test_default_schema_sql_defines_replan_jobs_with_leases(self):
        schema_sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")
        table_sql = schema_sql[
            schema_sql.index("CREATE TABLE replan_jobs") :
            schema_sql.index("CREATE TABLE idempotency_records")
        ]
        function_sql = schema_sql[
            schema_sql.index("CREATE FUNCTION claim_replan_jobs") :
            schema_sql.index("CREATE FUNCTION transfer_points")
        ]

        self.assertIn("source_plan_id UUID NOT NULL REFERENCES plans(id)", table_sql)
        self.assertIn("trigger_mutation_txn_id UUID NOT NULL", table_sql)
        self.assertIn("available_at TIMESTAMPTZ NOT NULL DEFAULT now()", table_sql)
        self.assertIn("locked_at TIMESTAMPTZ NULL", table_sql)
        self.assertIn("locked_by TEXT NULL", table_sql)
        self.assertIn("result_plan_id UUID NULL REFERENCES plans(id)", table_sql)
        self.assertIn("FOR UPDATE SKIP LOCKED", function_sql)
        self.assertIn("SET status = 'processing'", function_sql)
        self.assertIn("job.attempt_count < job.max_attempts", function_sql)

    def test_default_schema_sql_defines_transfer_and_atomic_promotion_functions(self):
        schema_sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")

        self.assertIn("CREATE FUNCTION transfer_points", schema_sql)
        self.assertIn("FROM user_balances", schema_sql)
        self.assertIn("pg_advisory_xact_lock", schema_sql)
        self.assertIn("INSERT INTO graph_mutations", schema_sql)
        self.assertIn("INSERT INTO replan_jobs", schema_sql)
        self.assertIn("CREATE FUNCTION promote_replan_job_success", schema_sql)
        self.assertIn("SET status = 'current'", schema_sql)
        self.assertIn("SET status = 'superseded'", schema_sql)
        self.assertIn("result plan is not direct successor of source plan", schema_sql)
        self.assertIn("result_plan.supersedes_plan_id = job.source_plan_id", schema_sql)

    def test_default_schema_sql_uses_locked_graph_mutations_contract(self):
        schema_sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")
        table_sql = schema_sql[
            schema_sql.index("CREATE TABLE graph_mutations") :
            schema_sql.index("CREATE TABLE replan_jobs")
        ]

        self.assertIn("id                  bigserial PRIMARY KEY", table_sql)
        self.assertIn("mutation_type       text NOT NULL", table_sql)
        self.assertIn("target_table        text", table_sql)
        self.assertIn("target_node_id      uuid", table_sql)
        self.assertIn("summary             text NOT NULL", table_sql)
        self.assertIn("before              jsonb", table_sql)
        self.assertIn("after               jsonb", table_sql)
        self.assertIn("committed_at        timestamptz NOT NULL DEFAULT now()", table_sql)
        self.assertNotIn("sequence", table_sql)
        self.assertNotIn("event_type", table_sql)
        self.assertNotIn("target_kind", table_sql)
        self.assertNotIn("target_id", table_sql)
        self.assertNotIn("before_value", table_sql)
        self.assertNotIn("after_value", table_sql)

    def test_default_schema_sql_uses_status_only_for_step_staleness(self):
        schema_sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")
        plan_steps_sql = schema_sql[
            schema_sql.index("CREATE TABLE plan_steps") :
            schema_sql.index("CREATE TABLE targets")
        ]
        transfer_sql = schema_sql[schema_sql.index("CREATE FUNCTION transfer_points") :]

        self.assertNotIn("staled_at", plan_steps_sql)
        self.assertNotIn("staled_at", transfer_sql)

    def test_default_schema_sql_defines_user_balance_staleness_backstop_trigger(self):
        schema_sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")

        self.assertIn(
            "CREATE FUNCTION mark_user_balance_dependents_stale_backstop",
            schema_sql,
        )
        self.assertIn(
            "CREATE TRIGGER user_balances_staleness_backstop",
            schema_sql,
        )
        self.assertIn("AFTER UPDATE OF balance_points, version ON user_balances", schema_sql)

    def test_transfer_functions_reject_in_progress_idempotency_records(self):
        schema_paths = (
            SCHEMA_SQL_PATH,
            EXPERIMENTAL_DIR / "schema.sql",
        )

        for schema_path in schema_paths:
            with self.subTest(schema_path=schema_path):
                schema_sql = schema_path.read_text(encoding="utf-8")
                transfer_sql = schema_sql[
                    schema_sql.index("CREATE FUNCTION transfer_points") :
                ]

                self.assertIn(
                    "idempotency request already in progress",
                    transfer_sql,
                )

    def test_transfer_points_claims_idempotency_record_with_upsert(self):
        schema_sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")
        transfer_sql = schema_sql[schema_sql.index("CREATE FUNCTION transfer_points") :]
        idempotency_sql = transfer_sql[
            transfer_sql.index("INSERT INTO idempotency_records") :
            transfer_sql.index("SELECT *\n    INTO source_balance")
        ]

        self.assertIn(
            "ON CONFLICT (user_id, operation_type, idempotency_key)",
            idempotency_sql,
        )
        self.assertIn("DO UPDATE", idempotency_sql)
        self.assertLess(
            idempotency_sql.index("ON CONFLICT"),
            idempotency_sql.index("SELECT *\n    INTO existing_idempotency"),
        )
        self.assertIn("FOR UPDATE", idempotency_sql)

    def test_polymorphic_artifacts_are_preserved_under_experimental_path(self):
        self.assertTrue((EXPERIMENTAL_DIR / "schema.sql").exists())
        self.assertTrue((EXPERIMENTAL_DIR / "graph.schema.json").exists())
        self.assertTrue((EXPERIMENTAL_DIR / "types.py").exists())
        self.assertTrue((EXPERIMENTAL_DIR / "mutations.py").exists())

        schema_sql = (EXPERIMENTAL_DIR / "schema.sql").read_text(encoding="utf-8")
        contract = json.loads(
            (EXPERIMENTAL_DIR / "graph.schema.json").read_text(encoding="utf-8")
        )

        self.assertIn("CREATE TABLE nodes", schema_sql)
        self.assertIn("CREATE TABLE edges", schema_sql)
        self.assertEqual(contract["title"], "Rewards Typed Graph MVP Contract")


class SchemaArtifactsLivePostgresTest(unittest.TestCase):
    def setUp(self):
        if os.environ.get("RUN_LIVE_POSTGRES_TESTS") != "1":
            self.skipTest("set RUN_LIVE_POSTGRES_TESTS=1 to run live Postgres tests")

        if shutil.which("psql") is None:
            self.skipTest("psql is required for live Postgres tests")

        database_name = os.environ.get("PGDATABASE", "")
        if "test" not in database_name:
            self.fail("live Postgres tests require PGDATABASE to include 'test'")

        version_num = _psql_rows("SHOW server_version_num")
        if not version_num or not (160000 <= version_num[0][0] < 170000):
            self.fail("live schema artifact tests require PostgreSQL 16")

        _psql_exec("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;")
        _psql_file(SCHEMA_SQL_PATH)

    def test_stale_plan_steps_view_contract_matches_applied_schema(self):
        self.assertEqual(
            _psql_rows(
                """
                SELECT column_name, data_type
                  FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'stale_plan_steps'
                 ORDER BY ordinal_position
                """
            ),
            [
                ("plan_step_id", "uuid"),
                ("plan_id", "uuid"),
                ("plan_lineage_id", "uuid"),
                ("revision_number", "integer"),
                ("target_node_id", "uuid"),
                ("target_node_type", "text"),
                ("target_table", "text"),
                ("observed_version", "integer"),
                ("current_version", "integer"),
            ],
        )

        _psql_exec(
            """
            INSERT INTO users (id, clerk_id, email)
            VALUES (
              '00000000-0000-0000-0000-000000000001',
              'clerk_schema_artifacts',
              'schema-artifacts@example.com'
            );

            INSERT INTO reward_programs (
              id,
              slug,
              name,
              program_kind,
              currency_name
            )
            VALUES (
              '00000000-0000-0000-0000-000000000101',
              'schema-artifacts-program',
              'Schema Artifacts Program',
              'issuer_transferable',
              'points'
            );

            INSERT INTO user_balances (
              id,
              user_id,
              program_id,
              balance_points,
              version
            )
            VALUES (
              '00000000-0000-0000-0000-000000000301',
              '00000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000101',
              240000,
              1
            );

            INSERT INTO plans (
              id,
              user_id,
              plan_lineage_id,
              revision_number,
              query_text,
              status
            )
            VALUES (
              '00000000-0000-0000-0000-000000000401',
              '00000000-0000-0000-0000-000000000001',
              '00000000-0000-0000-0000-000000000400',
              1,
              'Find the best Tokyo redemption.',
              'current'
            );

            INSERT INTO plan_steps (
              id,
              plan_id,
              plan_lineage_id,
              revision_number,
              step_order,
              step_type,
              status,
              payload
            )
            VALUES (
              '00000000-0000-0000-0000-000000000501',
              '00000000-0000-0000-0000-000000000401',
              '00000000-0000-0000-0000-000000000400',
              1,
              1,
              'transfer_recommendation',
              'current',
              '{"claim": "Transfer Chase points to Hyatt."}'
            );

            INSERT INTO state_dependencies (
              id,
              plan_step_id,
              target_node_id,
              target_node_type,
              target_table,
              depended_property,
              observed_version,
              snapshot_value
            )
            VALUES (
              '00000000-0000-0000-0000-000000000601',
              '00000000-0000-0000-0000-000000000501',
              '00000000-0000-0000-0000-000000000301',
              'UserBalance',
              'user_balances',
              'balance_points',
              0,
              '{"balance_points": 240000}'
            );
            """
        )

        self.assertEqual(
            _psql_rows(
                """
                SELECT
                  plan_step_id::text,
                  plan_id::text,
                  plan_lineage_id::text,
                  revision_number,
                  target_node_id::text,
                  target_node_type,
                  target_table,
                  observed_version,
                  current_version
                FROM stale_plan_steps
                """
            ),
            [
                (
                    "00000000-0000-0000-0000-000000000501",
                    "00000000-0000-0000-0000-000000000401",
                    "00000000-0000-0000-0000-000000000400",
                    1,
                    "00000000-0000-0000-0000-000000000301",
                    "UserBalance",
                    "user_balances",
                    0,
                    1,
                )
            ],
        )


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
