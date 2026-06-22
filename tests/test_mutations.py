import unittest

from schema.experimental.polymorphic.mutations import (
    GraphMutationService,
    MutationValidationError,
)
from schema.experimental.polymorphic.types import GraphNode


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

        if compact_sql.startswith("SELECT type, tier, user_id, slug, attributes, version FROM nodes"):
            node_id = params[0]
            node = self.connection.nodes.get(node_id)
            self.result = None if node is None else (
                node["type"],
                node["tier"],
                node.get("user_id"),
                node.get("slug"),
                node["attributes"],
                node["version"],
            )
            return

        if compact_sql.startswith("SELECT type FROM nodes WHERE id ="):
            node_id = params[0]
            node = self.connection.nodes.get(node_id)
            self.result = None if node is None else (node["type"],)
            return

        if compact_sql.startswith("SELECT user_id FROM nodes WHERE id ="):
            node_id = params[0]
            node = self.connection.nodes.get(node_id)
            self.result = None if node is None else (node.get("user_id"),)
            return

        if compact_sql.startswith("SELECT 1 FROM nodes WHERE type = 'Balance'"):
            user_id, program_id = params[:2]
            self.result = (1,) if (user_id, program_id) in self.connection.balances else None
            return

        if compact_sql.startswith("INSERT INTO nodes"):
            node_id = self.connection.next_node_id
            self.result = (node_id, 0)
            return

        if compact_sql.startswith("INSERT INTO edges"):
            edge_id = self.connection.next_edge_id
            self.result = (edge_id, 0)
            return

        if compact_sql.startswith("INSERT INTO graph_mutations"):
            self.result = None
            return

        if compact_sql.startswith("SELECT id, version FROM update_node_optimistic"):
            node_id, expected_version, _attributes = params
            self.result = (node_id, expected_version + 1)
            return

        if compact_sql.startswith("SELECT plan_step_id, depended_node_type"):
            self.result = self.connection.stale_rows
            return

        if compact_sql.startswith("SELECT id, version FROM mark_plan_step_stale"):
            plan_step_id, _reason = params
            self.result = self.connection.mark_stale_results.get(plan_step_id)
            return

        if compact_sql.startswith("SELECT source_id, source_version, successor_id, successor_version FROM supersede_plan_step"):
            source_plan_step_id, successor_attributes = params
            self.connection.supersede_calls.append((source_plan_step_id, successor_attributes))
            self.result = self.connection.supersede_result
            return

        if compact_sql.startswith("SELECT source_balance_id, source_version, dest_balance_id, dest_version, idempotency_replayed FROM transfer_points"):
            self.connection.transfer_points_calls.append(params)
            self.result = self.connection.transfer_points_result
            return

        self.result = None

    def fetchone(self):
        return self.result

    def fetchall(self):
        return self.result or []


class FakeConnection:
    def __init__(self):
        self.executed = []
        self.nodes = {}
        self.balances = set()
        self.stale_rows = []
        self.mark_stale_results = {}
        self.supersede_result = None
        self.supersede_calls = []
        self.transfer_points_result = None
        self.transfer_points_calls = []
        self.next_node_id = "node-1"
        self.next_edge_id = "edge-1"

    def cursor(self):
        return FakeCursor(self)


class GraphMutationServiceTest(unittest.TestCase):
    def test_create_node_rejects_structural_errors_before_commit(self):
        connection = FakeConnection()
        service = GraphMutationService(connection)

        with self.assertRaises(MutationValidationError) as raised:
            service.create_node(
                actor="wallet_agent",
                node=GraphNode(
                    type="Card",
                    tier="world",
                    attributes={
                        "name": "Chase Sapphire Preferred",
                        "issuer": "Chase",
                        "annual_fee_cents": 9500,
                    },
                ),
            )

        self.assertEqual(
            raised.exception.errors,
            ["Card.attributes missing required field: network"],
        )
        self.assertFalse(_any_sql(connection, "INSERT INTO nodes"))
        self.assertFalse(_any_sql(connection, "INSERT INTO graph_mutations"))

    def test_create_node_rejects_domain_errors_before_commit(self):
        connection = FakeConnection()
        service = GraphMutationService(connection)

        with self.assertRaises(MutationValidationError) as raised:
            service.create_node(
                actor="wallet_agent",
                node=GraphNode(
                    type="Balance",
                    tier="personal",
                    user_id="user-1",
                    attributes={
                        "program_id": "program-1",
                        "amount_points": -1,
                        "as_of": "2026-06-17T00:00:00Z",
                        "source": "manual_entry",
                    },
                ),
            )

        self.assertEqual(
            raised.exception.errors,
            ["Balance.attributes.amount_points must be nonnegative"],
        )
        self.assertFalse(_any_sql(connection, "INSERT INTO nodes"))

    def test_create_node_rejects_duplicate_balance_before_commit(self):
        connection = FakeConnection()
        connection.balances.add(("user-1", "program-1"))
        service = GraphMutationService(connection)

        with self.assertRaises(MutationValidationError) as raised:
            service.create_node(
                actor="wallet_agent",
                node=GraphNode(
                    type="Balance",
                    tier="personal",
                    user_id="user-1",
                    attributes={
                        "program_id": "program-1",
                        "amount_points": 240000,
                        "as_of": "2026-06-17T00:00:00Z",
                        "source": "manual_entry",
                    },
                ),
            )

        self.assertEqual(
            raised.exception.errors,
            ["Balance already exists for user_id=user-1 program_id=program-1"],
        )
        self.assertFalse(_any_sql(connection, "INSERT INTO nodes"))

    def test_create_edge_rejects_referential_type_errors_before_commit(self):
        connection = FakeConnection()
        connection.nodes = {
            "card-1": {"type": "Card"},
            "balance-1": {"type": "Balance"},
        }
        service = GraphMutationService(connection)

        with self.assertRaises(MutationValidationError) as raised:
            service.create_edge(
                actor="wallet_agent",
                edge_type="HAS_BALANCE",
                source_id="card-1",
                target_id="balance-1",
                attributes={},
            )

        self.assertEqual(
            raised.exception.errors,
            ["HAS_BALANCE edge source must be User, got Card"],
        )
        self.assertFalse(_any_sql(connection, "INSERT INTO edges"))
        self.assertFalse(_any_sql(connection, "INSERT INTO graph_mutations"))

    def test_create_edge_rejects_domain_errors_before_commit(self):
        connection = FakeConnection()
        connection.nodes = {
            "program-1": {"type": "Program"},
            "program-2": {"type": "Program"},
        }
        service = GraphMutationService(connection)

        with self.assertRaises(MutationValidationError) as raised:
            service.create_edge(
                actor="redemption_agent",
                edge_type="TRANSFERS_TO",
                source_id="program-1",
                target_id="program-2",
                attributes={
                    "ratio_num": 1,
                    "ratio_den": 0,
                    "transfer_time_days": 1,
                    "is_active": True,
                },
            )

        self.assertEqual(
            raised.exception.errors,
            ["TRANSFERS_TO.attributes.ratio_den must be greater than 0"],
        )
        self.assertFalse(_any_sql(connection, "INSERT INTO edges"))

    def test_create_node_inserts_and_logs_after_validation(self):
        connection = FakeConnection()
        service = GraphMutationService(connection)

        node_id = service.create_node(
            actor="wallet_agent",
            node=GraphNode(
                type="User",
                tier="personal",
                user_id="user-1",
                slug="user:demo",
                attributes={
                    "name": "Demo User",
                    "optimization_goal": "maximize_redemption_value",
                },
            ),
        )

        self.assertEqual(node_id, "node-1")
        self.assertTrue(_any_sql(connection, "INSERT INTO nodes"))
        self.assertTrue(_any_sql(connection, "INSERT INTO graph_mutations"))

    def test_create_edge_inserts_and_logs_after_validation(self):
        connection = FakeConnection()
        connection.nodes = {
            "user-1": {"type": "User"},
            "card-1": {"type": "Card", "user_id": "user-1"},
        }
        service = GraphMutationService(connection)

        edge_id = service.create_edge(
            actor="wallet_agent",
            edge_type="HOLDS",
            source_id="user-1",
            target_id="card-1",
            attributes={"is_primary": True},
        )

        self.assertEqual(edge_id, "edge-1")
        self.assertTrue(_any_sql(connection, "INSERT INTO edges"))
        self.assertTrue(_any_sql(connection, "INSERT INTO graph_mutations"))

    def test_update_node_rejects_invalid_attributes_before_commit(self):
        connection = FakeConnection()
        connection.nodes = {
            "balance-1": {
                "type": "Balance",
                "tier": "personal",
                "user_id": "user-1",
                "slug": None,
                "attributes": {
                    "program_id": "program-1",
                    "amount_points": 240000,
                    "as_of": "2026-06-17T00:00:00Z",
                    "source": "manual_entry",
                },
                "version": 0,
            },
        }
        service = GraphMutationService(connection)

        with self.assertRaises(MutationValidationError) as raised:
            service.update_node(
                actor="wallet_agent",
                node_id="balance-1",
                expected_version=0,
                attributes={
                    "program_id": "program-1",
                    "amount_points": -5,
                    "as_of": "2026-06-17T00:00:00Z",
                    "source": "manual_entry",
                },
            )

        self.assertEqual(
            raised.exception.errors,
            ["Balance.attributes.amount_points must be nonnegative"],
        )
        self.assertFalse(_any_sql(connection, "update_node_optimistic"))
        self.assertFalse(_any_sql(connection, "INSERT INTO graph_mutations"))

    def test_update_node_uses_optimistic_update_and_logs_after_validation(self):
        connection = FakeConnection()
        connection.nodes = {
            "user-1": {
                "type": "User",
                "tier": "personal",
                "user_id": "user-1",
                "slug": "user:demo",
                "attributes": {
                    "name": "Demo User",
                    "optimization_goal": "maximize_redemption_value",
                },
                "version": 0,
            },
        }
        service = GraphMutationService(connection)

        updated_id = service.update_node(
            actor="wallet_agent",
            node_id="user-1",
            expected_version=0,
            attributes={
                "name": "Demo User",
                "optimization_goal": "maximize_cashback",
            },
        )

        self.assertEqual(updated_id, "user-1")
        self.assertTrue(_any_sql(connection, "update_node_optimistic"))
        self.assertTrue(_any_sql(connection, "INSERT INTO graph_mutations"))

    def test_update_node_logs_actual_version_returned_by_mark_stale(self):
        connection = FakeConnection()
        connection.nodes = {
            "balance-1": {
                "type": "Balance",
                "tier": "personal",
                "user_id": "user-1",
                "slug": None,
                "attributes": {
                    "program_id": "program-1",
                    "amount_points": 240000,
                    "as_of": "2026-06-17T00:00:00Z",
                    "source": "manual_entry",
                },
                "version": 4,
            },
        }
        connection.stale_rows = [("plan-step-1", "Balance", 5, 4)]
        connection.mark_stale_results = {"plan-step-1": ("plan-step-1", 6)}
        service = GraphMutationService(connection)

        service.update_node(
            actor="wallet_agent",
            node_id="balance-1",
            expected_version=4,
            attributes={
                "program_id": "program-1",
                "amount_points": 180000,
                "as_of": "2026-06-20T00:00:00Z",
                "source": "manual_entry",
            },
        )

        mark_stale_logs = [
            params
            for sql, params in connection.executed
            if "INSERT INTO graph_mutations" in sql and params[2] == "mark_stale"
        ]
        self.assertEqual(len(mark_stale_logs), 1)
        self.assertEqual(mark_stale_logs[0][8], 6)

    def test_supersede_plan_step_creates_successor_revision_and_logs(self):
        connection = FakeConnection()
        connection.nodes = {
            "plan-step-1": {
                "type": "PlanStep",
                "tier": "plan",
                "user_id": "user-1",
                "slug": None,
                "attributes": {
                    "plan_lineage_id": "plan-lineage-1",
                    "revision_number": 1,
                    "step_order": 1,
                    "agent": "redemption_agent",
                    "claim": "Transfer Chase points to Hyatt.",
                    "inputs": {},
                    "output": {},
                    "status": "stale",
                    "stale_reason": "Balance:balance-1 version changed from 4 to 5",
                },
                "version": 7,
            },
        }
        connection.supersede_result = ("plan-step-1", 8, "plan-step-2", 0)
        service = GraphMutationService(connection)

        successor_id = service.supersede_plan_step(
            actor="redemption_agent",
            source_plan_step_id="plan-step-1",
            successor_attributes={
                "step_order": 1,
                "agent": "redemption_agent",
                "claim": "Transfer Chase points to Hyatt after balance change.",
                "inputs": {},
                "output": {"recommendation": "Transfer 90000 points."},
                "status": "active",
            },
        )

        self.assertEqual(successor_id, "plan-step-2")
        self.assertEqual(len(connection.supersede_calls), 1)
        _source_id, successor_attributes = connection.supersede_calls[0]
        self.assertEqual(successor_attributes["plan_lineage_id"], "plan-lineage-1")
        self.assertEqual(successor_attributes["revision_number"], 2)
        self.assertEqual(successor_attributes["supersedes_plan_step_id"], "plan-step-1")
        self.assertEqual(successor_attributes["stale_reason"], None)

        supersede_logs = [
            params
            for sql, params in connection.executed
            if "INSERT INTO graph_mutations" in sql and params[2] == "supersede_plan_step"
        ]
        self.assertEqual(len(supersede_logs), 1)
        self.assertEqual(supersede_logs[0][4], "plan-step-1")
        self.assertEqual(supersede_logs[0][7]["successor_plan_step_id"], "plan-step-2")
        self.assertEqual(supersede_logs[0][8], 8)

    def test_transfer_points_calls_atomic_sql_function_with_idempotency_key(self):
        connection = FakeConnection()
        connection.transfer_points_result = (
            "balance-source",
            5,
            "balance-dest",
            8,
            False,
        )
        service = GraphMutationService(connection)

        result = service.transfer_points(
            actor="wallet_agent",
            user_id="user-1",
            source_balance_id="balance-source",
            dest_balance_id="balance-dest",
            amount_points=60000,
            source_expected_version=4,
            dest_expected_version=7,
            idempotency_key="transfer-123",
            request_hash="hash-abc",
        )

        self.assertEqual(
            result,
            {
                "source_balance_id": "balance-source",
                "source_version": 5,
                "dest_balance_id": "balance-dest",
                "dest_version": 8,
                "idempotency_replayed": False,
            },
        )
        self.assertEqual(
            connection.transfer_points_calls,
            [
                (
                    "user-1",
                    "balance-source",
                    "balance-dest",
                    60000,
                    4,
                    7,
                    "transfer-123",
                    "hash-abc",
                    "wallet_agent",
                )
            ],
        )


def _any_sql(connection, snippet):
    return any(snippet in sql for sql, _ in connection.executed)


if __name__ == "__main__":
    unittest.main()
