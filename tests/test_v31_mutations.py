import unittest

from schema.mutations import (
    CreatePlanRequest,
    CreatePlanStepRequest,
    MutationCommitError,
    MutationValidationError,
    RecordStateDependencyRequest,
    TransferPointsRequest,
    V31GraphWriteService,
)


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
            self.result = None
            return

        self.result = None

    def fetchone(self):
        return self.result


class FakeConnection:
    def __init__(self):
        self.executed = []
        self.transfer_points_calls = []
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


def _any_sql(connection, snippet):
    return any(snippet in sql for sql, _ in connection.executed)


def _first_sql(connection, snippet):
    for sql, params in connection.executed:
        if snippet in sql:
            return sql, params
    raise AssertionError(f"SQL fragment not executed: {snippet}")


if __name__ == "__main__":
    unittest.main()
