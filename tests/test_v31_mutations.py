import os
import shutil
import subprocess
import unittest
from pathlib import Path

from schema.mutations import (
    ConcurrencyConflictError,
    CreatePlanRequest,
    CreatePlanStepRequest,
    MAX_OCC_RETRIES,
    MutationCommitError,
    MutationValidationError,
    ReadSetEntry,
    RecordStateDependencyRequest,
    TransferPointsRequest,
    V31GraphWriteService,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_SQL_PATH = REPO_ROOT / "schema" / "schema.sql"


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection
        self.result = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, sql, params=None):
        params = params or ()
        self.connection.executed.append((sql, params))
        compact_sql = " ".join(sql.split())

        if compact_sql.startswith(
            "SELECT source_balance_id, source_version, dest_balance_id"
        ):
            self.connection.transfer_points_calls.append(params)
            if self.connection.transfer_points_errors:
                raise self.connection.transfer_points_errors.pop(0)
            self.result = self.connection.transfer_points_result
            return

        if compact_sql.startswith("SELECT user_id, plan_lineage_id, revision_number FROM plans"):
            plan_id = params[0]
            self.result = self.connection.plans.get(plan_id)
            return

        if compact_sql.startswith("SELECT p.user_id, ps.plan_lineage_id"):
            plan_step_id = params[0]
            self.result = self.connection.plan_steps.get(plan_step_id)
            return

        if compact_sql.startswith("SELECT node_type, version, user_id FROM user_balances"):
            target_id = params[0]
            self.result = self.connection.user_balances.get(target_id)
            return

        if compact_sql.startswith("SELECT pg_advisory_xact_lock"):
            self.result = None
            return

        if compact_sql.startswith("INSERT INTO plans"):
            self.result = self.connection.create_plan_result
            return

        if compact_sql.startswith("INSERT INTO plan_steps"):
            self.result = self.connection.create_plan_step_result
            return

        if compact_sql.startswith("INSERT INTO state_dependencies"):
            self.result = self.connection.record_state_dependency_result
            return

        if compact_sql.startswith("INSERT INTO graph_mutations"):
            self.connection.graph_mutation_inserts += 1
            self.result = None
            return

        self.result = None

    def fetchone(self):
        return self.result


class FakeConnection:
    def __init__(self):
        self.executed = []
        self.graph_mutation_inserts = 0
        self.transfer_points_calls = []
        self.transfer_points_errors = []
        self.transfer_points_result = None
        self.plans = {}
        self.plan_steps = {}
        self.user_balances = {}
        self.create_plan_result = None
        self.create_plan_step_result = None
        self.record_state_dependency_result = None

    def cursor(self):
        return FakeCursor(self)


class V31GraphWriteServiceTest(unittest.TestCase):
    def test_read_set_rejects_stale_user_balance_before_write(self):
        connection = FakeConnection()
        connection.user_balances = {
            "00000000-0000-0000-0000-000000000040": (
                "UserBalance",
                3,
                "00000000-0000-0000-0000-000000000001",
            )
        }
        service = V31GraphWriteService(connection)

        with self.assertRaises(ConcurrencyConflictError):
            service.validate_read_set(
                user_id="00000000-0000-0000-0000-000000000001",
                read_set=[
                    ReadSetEntry(
                        target_table="user_balances",
                        target_node_id="00000000-0000-0000-0000-000000000040",
                        observed_version=2,
                    )
                ],
            )

        self.assertEqual(connection.graph_mutation_inserts, 0)

    def test_read_set_rejects_scoped_target_without_owner_before_version_compare(self):
        connection = FakeConnection()
        connection.user_balances = {
            "00000000-0000-0000-0000-000000000040": (
                "UserBalance",
                3,
                None,
            )
        }
        service = V31GraphWriteService(connection)

        with self.assertRaises(MutationValidationError) as raised:
            service.validate_read_set(
                user_id="00000000-0000-0000-0000-000000000001",
                read_set=[
                    ReadSetEntry(
                        target_table="user_balances",
                        target_node_id="00000000-0000-0000-0000-000000000040",
                        observed_version=2,
                    )
                ],
            )

        self.assertEqual(
            raised.exception.errors,
            [
                "ReadSet target does not exist or is not visible to user "
                "00000000-0000-0000-0000-000000000001"
            ],
        )
        self.assertEqual(connection.graph_mutation_inserts, 0)

    def test_occ_retry_returns_success_after_retryable_conflict(self):
        service = V31GraphWriteService(FakeConnection())
        attempts = []

        def attempt():
            attempts.append("try")
            if len(attempts) < 2:
                raise RuntimeError("source balance version conflict")
            return "committed"

        result = service.with_occ_retry(
            attempt,
            retryable_errors=("source balance version conflict",),
        )

        self.assertEqual(result, "committed")
        self.assertEqual(len(attempts), 2)

    def test_occ_retry_returns_success_after_postgres_called_process_conflict(self):
        service = V31GraphWriteService(FakeConnection())
        attempts = []

        def attempt():
            attempts.append("try")
            if len(attempts) < 2:
                raise subprocess.CalledProcessError(
                    1,
                    ["psql"],
                    stderr="ERROR: source balance version conflict",
                )
            return "committed"

        result = service.with_occ_retry(
            attempt,
            retryable_errors=("source balance version conflict",),
        )

        self.assertEqual(result, "committed")
        self.assertEqual(len(attempts), 2)

    def test_occ_retry_stops_after_three_attempts(self):
        service = V31GraphWriteService(FakeConnection())
        attempts = []

        def attempt():
            attempts.append("try")
            raise RuntimeError("source balance version conflict")

        with self.assertRaises(ConcurrencyConflictError):
            service.with_occ_retry(
                attempt,
                retryable_errors=("source balance version conflict",),
            )

        self.assertEqual(len(attempts), MAX_OCC_RETRIES)

    def test_create_plan_rejects_invalid_status_before_sql(self):
        connection = FakeConnection()
        service = V31GraphWriteService(connection)

        with self.assertRaises(MutationValidationError) as raised:
            service.create_plan(
                CreatePlanRequest(
                    actor="orchestrator",
                    user_id="00000000-0000-0000-0000-000000000001",
                    plan_lineage_id="00000000-0000-0000-0000-000000000010",
                    revision_number=1,
                    query_text="Tokyo in October",
                    status="active",
                )
            )

        self.assertEqual(
            raised.exception.errors,
            [
                "Plan.attributes.status must be one of "
                "('generating', 'current', 'stale', 'failed', 'superseded')"
            ],
        )
        self.assertEqual(connection.executed, [])

    def test_create_plan_inserts_and_logs_after_validation(self):
        connection = FakeConnection()
        connection.create_plan_result = (
            "00000000-0000-0000-0000-000000000020",
            0,
        )
        service = V31GraphWriteService(connection)

        plan_id = service.create_plan(
            CreatePlanRequest(
                actor="orchestrator",
                user_id="00000000-0000-0000-0000-000000000001",
                plan_lineage_id="00000000-0000-0000-0000-000000000010",
                revision_number=1,
                query_text="Tokyo in October",
            )
        )

        self.assertEqual(plan_id, "00000000-0000-0000-0000-000000000020")
        self.assertTrue(_any_sql(connection, "SELECT pg_advisory_xact_lock"))
        self.assertTrue(_any_sql(connection, "INSERT INTO plans"))
        self.assertTrue(_any_sql(connection, "INSERT INTO graph_mutations"))
        graph_sql, graph_params = _first_sql(connection, "INSERT INTO graph_mutations")
        self.assertIn("mutation_type", graph_sql)
        self.assertIn("target_table", graph_sql)
        self.assertIn("target_node_id", graph_sql)
        self.assertIn("summary", graph_sql)
        self.assertIn("before", graph_sql)
        self.assertIn("after", graph_sql)
        self.assertNotIn("event_type", graph_sql)
        self.assertNotIn("target_kind", graph_sql)
        self.assertNotIn("before_value", graph_sql)
        self.assertEqual(graph_params[4:8], ("CreatePlan", "plans", plan_id, "Created plan"))

    def test_create_plan_step_rejects_missing_plan_before_insert(self):
        connection = FakeConnection()
        service = V31GraphWriteService(connection)

        with self.assertRaises(MutationValidationError) as raised:
            service.create_plan_step(
                CreatePlanStepRequest(
                    actor="redemption_agent",
                    user_id="00000000-0000-0000-0000-000000000001",
                    plan_id="00000000-0000-0000-0000-000000000020",
                    plan_lineage_id="00000000-0000-0000-0000-000000000010",
                    revision_number=1,
                    step_order=1,
                    step_type="transfer_recommendation",
                    payload={"claim": "Transfer Chase points to Hyatt"},
                )
            )

        self.assertEqual(
            raised.exception.errors,
            [
                "PlanStep.plan_id does not exist or is not visible to user "
                "00000000-0000-0000-0000-000000000001"
            ],
        )
        self.assertFalse(_any_sql(connection, "INSERT INTO plan_steps"))

    def test_create_plan_step_inserts_and_logs_after_validation(self):
        connection = FakeConnection()
        connection.plans = {
            "00000000-0000-0000-0000-000000000020": (
                "00000000-0000-0000-0000-000000000001",
                "00000000-0000-0000-0000-000000000010",
                1,
            )
        }
        connection.create_plan_step_result = (
            "00000000-0000-0000-0000-000000000030",
            0,
        )
        service = V31GraphWriteService(connection)

        plan_step_id = service.create_plan_step(
            CreatePlanStepRequest(
                actor="redemption_agent",
                user_id="00000000-0000-0000-0000-000000000001",
                plan_id="00000000-0000-0000-0000-000000000020",
                plan_lineage_id="00000000-0000-0000-0000-000000000010",
                revision_number=1,
                step_order=1,
                step_type="transfer_recommendation",
                payload={"claim": "Transfer Chase points to Hyatt"},
            )
        )

        self.assertEqual(plan_step_id, "00000000-0000-0000-0000-000000000030")
        self.assertTrue(_any_sql(connection, "SELECT pg_advisory_xact_lock"))
        self.assertTrue(_any_sql(connection, "INSERT INTO plan_steps"))
        self.assertTrue(_any_sql(connection, "INSERT INTO graph_mutations"))

    def test_record_state_dependency_rejects_unknown_target_table_before_sql(self):
        connection = FakeConnection()
        service = V31GraphWriteService(connection)

        with self.assertRaises(MutationValidationError) as raised:
            service.record_state_dependency(
                RecordStateDependencyRequest(
                    actor="redemption_agent",
                    user_id="00000000-0000-0000-0000-000000000001",
                    plan_step_id="00000000-0000-0000-0000-000000000030",
                    target_node_id="00000000-0000-0000-0000-000000000040",
                    target_node_type="UserBalance",
                    target_table="not_a_table",
                    observed_version=0,
                    snapshot_value={"balance_points": 240000},
                )
            )

        self.assertEqual(
            raised.exception.errors,
            ["StateDependency.target_table is not allowed: not_a_table"],
        )
        self.assertEqual(connection.executed, [])

    def test_record_state_dependency_inserts_and_logs_after_validation(self):
        connection = FakeConnection()
        connection.plan_steps = {
            "00000000-0000-0000-0000-000000000030": (
                "00000000-0000-0000-0000-000000000001",
                "00000000-0000-0000-0000-000000000010",
                1,
            )
        }
        connection.user_balances = {
            "00000000-0000-0000-0000-000000000040": (
                "UserBalance",
                0,
                "00000000-0000-0000-0000-000000000001",
            )
        }
        connection.record_state_dependency_result = (
            "00000000-0000-0000-0000-000000000050",
            0,
        )
        service = V31GraphWriteService(connection)

        dependency_id = service.record_state_dependency(
            RecordStateDependencyRequest(
                actor="redemption_agent",
                user_id="00000000-0000-0000-0000-000000000001",
                plan_step_id="00000000-0000-0000-0000-000000000030",
                target_node_id="00000000-0000-0000-0000-000000000040",
                target_node_type="UserBalance",
                target_table="user_balances",
                observed_version=0,
                snapshot_value={"balance_points": 240000},
            )
        )

        self.assertEqual(dependency_id, "00000000-0000-0000-0000-000000000050")
        self.assertTrue(_any_sql(connection, "SELECT pg_advisory_xact_lock"))
        self.assertTrue(_any_sql(connection, "INSERT INTO state_dependencies"))
        self.assertTrue(_any_sql(connection, "INSERT INTO graph_mutations"))

    def test_record_state_dependency_uses_hardcoded_target_reference_query(self):
        connection = FakeConnection()
        connection.plan_steps = {
            "00000000-0000-0000-0000-000000000030": (
                "00000000-0000-0000-0000-000000000001",
                "00000000-0000-0000-0000-000000000010",
                1,
            )
        }
        connection.user_balances = {
            "00000000-0000-0000-0000-000000000040": (
                "UserBalance",
                0,
                "00000000-0000-0000-0000-000000000001",
            )
        }
        connection.record_state_dependency_result = (
            "00000000-0000-0000-0000-000000000050",
            0,
        )
        service = V31GraphWriteService(connection)

        service.record_state_dependency(
            RecordStateDependencyRequest(
                actor="redemption_agent",
                user_id="00000000-0000-0000-0000-000000000001",
                plan_step_id="00000000-0000-0000-0000-000000000030",
                target_node_id="00000000-0000-0000-0000-000000000040",
                target_node_type="UserBalance",
                target_table="user_balances",
                observed_version=0,
                snapshot_value={"balance_points": 240000},
            )
        )

        self.assertTrue(_any_sql(connection, "FROM user_balances"))
        self.assertFalse(_any_sql(connection, "FROM {target_table}"))

    def test_transfer_points_rejects_invalid_amount_before_sql(self):
        connection = FakeConnection()
        service = V31GraphWriteService(connection)

        with self.assertRaises(MutationValidationError) as raised:
            service.transfer_points(
                TransferPointsRequest(
                    actor="wallet_agent",
                    user_id="00000000-0000-0000-0000-000000000001",
                    source_balance_id="00000000-0000-0000-0000-000000000002",
                    dest_balance_id="00000000-0000-0000-0000-000000000003",
                    amount_points=0,
                    source_expected_version=1,
                    dest_expected_version=2,
                    idempotency_key="transfer-1",
                    request_hash="hash-1",
                )
            )

        self.assertEqual(
            raised.exception.errors,
            ["TransferPoints.amount_points must be greater than 0"],
        )
        self.assertEqual(connection.executed, [])

    def test_transfer_points_rejects_same_balance_before_sql(self):
        connection = FakeConnection()
        service = V31GraphWriteService(connection)

        with self.assertRaises(MutationValidationError) as raised:
            service.transfer_points(
                TransferPointsRequest(
                    actor="wallet_agent",
                    user_id="00000000-0000-0000-0000-000000000001",
                    source_balance_id="00000000-0000-0000-0000-000000000002",
                    dest_balance_id="00000000-0000-0000-0000-000000000002",
                    amount_points=1000,
                    source_expected_version=1,
                    dest_expected_version=2,
                    idempotency_key="transfer-1",
                    request_hash="hash-1",
                )
            )

        self.assertEqual(
            raised.exception.errors,
            ["TransferPoints.source_balance_id and dest_balance_id must differ"],
        )
        self.assertEqual(connection.executed, [])

    def test_transfer_points_delegates_to_atomic_sql_function_after_validation(self):
        connection = FakeConnection()
        connection.transfer_points_result = (
            "00000000-0000-0000-0000-000000000002",
            2,
            "00000000-0000-0000-0000-000000000003",
            3,
            False,
        )
        service = V31GraphWriteService(connection)

        result = service.transfer_points(
            TransferPointsRequest(
                actor="wallet_agent",
                user_id="00000000-0000-0000-0000-000000000001",
                source_balance_id="00000000-0000-0000-0000-000000000002",
                dest_balance_id="00000000-0000-0000-0000-000000000003",
                amount_points=60000,
                source_expected_version=1,
                dest_expected_version=2,
                idempotency_key="transfer-1",
                request_hash="hash-1",
            )
        )

        self.assertEqual(
            result,
            {
                "source_balance_id": "00000000-0000-0000-0000-000000000002",
                "source_version": 2,
                "dest_balance_id": "00000000-0000-0000-0000-000000000003",
                "dest_version": 3,
                "idempotency_replayed": False,
            },
        )
        self.assertEqual(
            connection.transfer_points_calls,
            [
                (
                    "00000000-0000-0000-0000-000000000001",
                    "00000000-0000-0000-0000-000000000002",
                    "00000000-0000-0000-0000-000000000003",
                    60000,
                    1,
                    2,
                    "transfer-1",
                    "hash-1",
                    "wallet_agent",
                )
            ],
        )

    def test_transfer_points_rejects_stale_read_set_before_sql_function(self):
        connection = FakeConnection()
        connection.user_balances = {
            "00000000-0000-0000-0000-000000000002": (
                "UserBalance",
                2,
                "00000000-0000-0000-0000-000000000001",
            )
        }
        service = V31GraphWriteService(connection)

        with self.assertRaises(ConcurrencyConflictError):
            service.transfer_points(
                TransferPointsRequest(
                    actor="wallet_agent",
                    user_id="00000000-0000-0000-0000-000000000001",
                    source_balance_id="00000000-0000-0000-0000-000000000002",
                    dest_balance_id="00000000-0000-0000-0000-000000000003",
                    amount_points=60000,
                    source_expected_version=1,
                    dest_expected_version=2,
                    idempotency_key="transfer-1",
                    request_hash="hash-1",
                    read_set=(
                        ReadSetEntry(
                            target_table="user_balances",
                            target_node_id="00000000-0000-0000-0000-000000000002",
                            observed_version=1,
                        ),
                    ),
                )
            )

        self.assertEqual(connection.transfer_points_calls, [])

    def test_transfer_points_validates_read_set_after_user_lock_before_sql_function(self):
        connection = FakeConnection()
        connection.user_balances = {
            "00000000-0000-0000-0000-000000000002": (
                "UserBalance",
                1,
                "00000000-0000-0000-0000-000000000001",
            )
        }
        connection.transfer_points_result = (
            "00000000-0000-0000-0000-000000000002",
            2,
            "00000000-0000-0000-0000-000000000003",
            3,
            False,
        )
        service = V31GraphWriteService(connection)

        service.transfer_points(
            TransferPointsRequest(
                actor="wallet_agent",
                user_id="00000000-0000-0000-0000-000000000001",
                source_balance_id="00000000-0000-0000-0000-000000000002",
                dest_balance_id="00000000-0000-0000-0000-000000000003",
                amount_points=60000,
                source_expected_version=1,
                dest_expected_version=2,
                idempotency_key="transfer-1",
                request_hash="hash-1",
                read_set=(
                    ReadSetEntry(
                        target_table="user_balances",
                        target_node_id="00000000-0000-0000-0000-000000000002",
                        observed_version=1,
                    ),
                ),
            )
        )

        lock_index = _sql_index(connection, "SELECT pg_advisory_xact_lock")
        read_set_index = _sql_index(connection, "SELECT node_type, version, user_id")
        transfer_index = _sql_index(connection, "source_balance_id")
        self.assertLess(lock_index, read_set_index)
        self.assertLess(read_set_index, transfer_index)

    def test_transfer_points_retries_retryable_version_conflict(self):
        connection = FakeConnection()
        connection.transfer_points_errors = [
            RuntimeError("source balance version conflict"),
            RuntimeError("source balance version conflict"),
        ]
        connection.transfer_points_result = (
            "00000000-0000-0000-0000-000000000002",
            2,
            "00000000-0000-0000-0000-000000000003",
            3,
            False,
        )
        service = V31GraphWriteService(connection)

        result = service.transfer_points(
            TransferPointsRequest(
                actor="wallet_agent",
                user_id="00000000-0000-0000-0000-000000000001",
                source_balance_id="00000000-0000-0000-0000-000000000002",
                dest_balance_id="00000000-0000-0000-0000-000000000003",
                amount_points=60000,
                source_expected_version=1,
                dest_expected_version=2,
                idempotency_key="transfer-1",
                request_hash="hash-1",
            )
        )

        self.assertEqual(
            result,
            {
                "source_balance_id": "00000000-0000-0000-0000-000000000002",
                "source_version": 2,
                "dest_balance_id": "00000000-0000-0000-0000-000000000003",
                "dest_version": 3,
                "idempotency_replayed": False,
            },
        )
        self.assertEqual(len(connection.transfer_points_calls), 3)

    def test_transfer_points_raises_when_sql_function_returns_no_result(self):
        connection = FakeConnection()
        service = V31GraphWriteService(connection)

        with self.assertRaises(MutationCommitError) as raised:
            service.transfer_points(
                TransferPointsRequest(
                    actor="wallet_agent",
                    user_id="00000000-0000-0000-0000-000000000001",
                    source_balance_id="00000000-0000-0000-0000-000000000002",
                    dest_balance_id="00000000-0000-0000-0000-000000000003",
                    amount_points=60000,
                    source_expected_version=1,
                    dest_expected_version=2,
                    idempotency_key="transfer-1",
                    request_hash="hash-1",
                )
            )

        self.assertEqual(str(raised.exception), "TransferPoints returned no result")


class V31GraphWriteServiceLivePostgresTest(unittest.TestCase):
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
            INSERT INTO users (id, clerk_id, email)
            VALUES (
              '00000000-0000-0000-0000-00000000a001',
              'clerk_live_transfer',
              'live-transfer@example.com'
            );

            INSERT INTO reward_programs (
              id,
              slug,
              name,
              program_kind,
              currency_name
            )
            VALUES
              (
                '00000000-0000-0000-0000-00000000b001',
                'live-chase-ultimate-rewards',
                'Live Chase Ultimate Rewards',
                'issuer_transferable',
                'points'
              ),
              (
                '00000000-0000-0000-0000-00000000b002',
                'live-world-of-hyatt',
                'Live World of Hyatt',
                'hotel',
                'points'
              );

            INSERT INTO transfers_to (
              id,
              source_program_id,
              dest_program_id,
              transfer_ratio_basis_points,
              transfer_time_days
            )
            VALUES (
              '00000000-0000-0000-0000-00000000c001',
              '00000000-0000-0000-0000-00000000b001',
              '00000000-0000-0000-0000-00000000b002',
              10000,
              1
            );

            INSERT INTO user_balances (
              id,
              user_id,
              program_id,
              balance_points,
              version
            )
            VALUES
              (
                '00000000-0000-0000-0000-00000000d001',
                '00000000-0000-0000-0000-00000000a001',
                '00000000-0000-0000-0000-00000000b001',
                240000,
                1
              ),
              (
                '00000000-0000-0000-0000-00000000d002',
                '00000000-0000-0000-0000-00000000a001',
                '00000000-0000-0000-0000-00000000b002',
                0,
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
              '00000000-0000-0000-0000-00000000e001',
              '00000000-0000-0000-0000-00000000a001',
              '00000000-0000-0000-0000-00000000e000',
              1,
              'Live transfer test plan.',
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
              '00000000-0000-0000-0000-00000000f001',
              '00000000-0000-0000-0000-00000000e001',
              '00000000-0000-0000-0000-00000000e000',
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
              '00000000-0000-0000-0000-00000000f101',
              '00000000-0000-0000-0000-00000000f001',
              '00000000-0000-0000-0000-00000000d001',
              'UserBalance',
              'user_balances',
              'balance_points',
              1,
              '{"balance_points": 240000}'
            );
            """
        )

    def test_transfer_points_updates_balances_replays_and_enqueues_staleness(self):
        service = V31GraphWriteService(_PsqlConnection())
        request = TransferPointsRequest(
            actor="wallet_agent",
            user_id="00000000-0000-0000-0000-00000000a001",
            source_balance_id="00000000-0000-0000-0000-00000000d001",
            dest_balance_id="00000000-0000-0000-0000-00000000d002",
            amount_points=60000,
            source_expected_version=1,
            dest_expected_version=1,
            idempotency_key="live-transfer-1",
            request_hash="live-transfer-hash-1",
        )

        result = service.transfer_points(request)

        self.assertEqual(
            result,
            {
                "source_balance_id": "00000000-0000-0000-0000-00000000d001",
                "source_version": 2,
                "dest_balance_id": "00000000-0000-0000-0000-00000000d002",
                "dest_version": 2,
                "idempotency_replayed": False,
            },
        )
        self.assertEqual(
            _psql_rows(
                """
                SELECT id, balance_points, version
                  FROM user_balances
                 ORDER BY id
                """
            ),
            [
                ("00000000-0000-0000-0000-00000000d001", 180000, 2),
                ("00000000-0000-0000-0000-00000000d002", 60000, 2),
            ],
        )
        self.assertEqual(
            _psql_rows(
                """
                SELECT p.status, ps.status, count(rj.id)
                  FROM plans p
                  JOIN plan_steps ps ON ps.plan_id = p.id
                  LEFT JOIN replan_jobs rj ON rj.source_plan_id = p.id
                 WHERE p.id = '00000000-0000-0000-0000-00000000e001'
                 GROUP BY p.status, ps.status
                """
            ),
            [("stale", "stale", 1)],
        )
        self.assertEqual(
            _psql_rows(
                """
                SELECT mutation_type, count(*)
                  FROM graph_mutations
                 GROUP BY mutation_type
                 ORDER BY mutation_type
                """
            ),
            [("MarkStale", 1), ("TransferPoints", 2)],
        )

        replayed = service.transfer_points(request)

        self.assertEqual(
            replayed,
            {
                "source_balance_id": "00000000-0000-0000-0000-00000000d001",
                "source_version": 2,
                "dest_balance_id": "00000000-0000-0000-0000-00000000d002",
                "dest_version": 2,
                "idempotency_replayed": True,
            },
        )
        self.assertEqual(
            _psql_rows(
                """
                SELECT id, balance_points, version
                  FROM user_balances
                 ORDER BY id
                """
            ),
            [
                ("00000000-0000-0000-0000-00000000d001", 180000, 2),
                ("00000000-0000-0000-0000-00000000d002", 60000, 2),
            ],
        )
        self.assertEqual(_psql_rows("SELECT count(*) FROM replan_jobs"), [(1,)])


def _any_sql(connection, snippet):
    return any(snippet in sql for sql, _ in connection.executed)


def _first_sql(connection, snippet):
    for sql, params in connection.executed:
        if snippet in sql:
            return sql, params
    raise AssertionError(f"SQL fragment not executed: {snippet}")


def _sql_index(connection, snippet):
    for index, (sql, _params) in enumerate(connection.executed):
        if snippet in sql:
            return index
    raise AssertionError(f"SQL fragment not executed: {snippet}")


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
