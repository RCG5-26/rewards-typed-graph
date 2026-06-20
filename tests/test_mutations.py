import unittest

from schema.mutations import GraphMutationService, MutationValidationError
from schema.types import GraphNode


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

        if compact_sql.startswith("INSERT INTO mutation_log"):
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
        self.assertFalse(_any_sql(connection, "INSERT INTO mutation_log"))

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
        self.assertFalse(_any_sql(connection, "INSERT INTO mutation_log"))

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
        self.assertTrue(_any_sql(connection, "INSERT INTO mutation_log"))

    def test_create_edge_inserts_and_logs_after_validation(self):
        connection = FakeConnection()
        connection.nodes = {
            "user-1": {"type": "User"},
            "card-1": {"type": "Card"},
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
        self.assertTrue(_any_sql(connection, "INSERT INTO mutation_log"))

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
        self.assertFalse(_any_sql(connection, "INSERT INTO mutation_log"))

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
        self.assertTrue(_any_sql(connection, "INSERT INTO mutation_log"))

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
            if "INSERT INTO mutation_log" in sql and params[1] == "mark_stale"
        ]
        self.assertEqual(len(mark_stale_logs), 1)
        self.assertEqual(mark_stale_logs[0][7], 6)


def _any_sql(connection, snippet):
    return any(snippet in sql for sql, _ in connection.executed)


if __name__ == "__main__":
    unittest.main()
