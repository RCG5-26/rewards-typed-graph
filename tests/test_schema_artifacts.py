import pathlib
import unittest


SCHEMA_SQL_PATH = pathlib.Path(__file__).resolve().parents[1] / "schema" / "schema.sql"


class SchemaArtifactsTest(unittest.TestCase):
    def test_python_schema_exports_mvp_enums_and_validation(self):
        from schema import types

        self.assertEqual(
            types.NODE_TYPES,
            (
                "User",
                "Card",
                "Program",
                "MerchantCategory",
                "Balance",
                "Goal",
                "PlanQuery",
                "PlanStep",
            ),
        )
        self.assertIn("DEPENDS_ON", types.EDGE_TYPES)
        self.assertEqual(types.GRAPH_TIERS, ("world", "personal", "plan"))

        balance = types.GraphNode(
            type="Balance",
            tier="personal",
            attributes={
                "program_id": "00000000-0000-0000-0000-000000000000",
                "amount_points": 240000,
                "as_of": "2026-06-17T00:00:00Z",
                "source": "manual_entry",
            },
        )

        self.assertEqual(types.validate_node(balance), [])

        bad_card = types.GraphNode(
            type="Card",
            tier="world",
            attributes={
                "name": "Chase Sapphire Preferred",
                "issuer": "Chase",
                "annual_fee_cents": 9500,
            },
        )

        self.assertEqual(
            types.validate_node(bad_card),
            ["Card.attributes missing required field: network"],
        )

    def test_edge_validation_enforces_source_and_target_types(self):
        from schema import types

        valid_edge = types.GraphEdge(
            type="HAS_BALANCE",
            source_type="User",
            target_type="Balance",
            attributes={},
        )
        invalid_edge = types.GraphEdge(
            type="HAS_BALANCE",
            source_type="Card",
            target_type="Balance",
            attributes={},
        )

        self.assertEqual(types.validate_edge(valid_edge), [])
        self.assertEqual(
            types.validate_edge(invalid_edge),
            ["HAS_BALANCE edge source must be User, got Card"],
        )

    def test_node_validation_enforces_attribute_types(self):
        from schema import types

        bad_balance = types.GraphNode(
            type="Balance",
            tier="personal",
            attributes={
                "program_id": "00000000-0000-0000-0000-000000000000",
                "amount_points": "240000",
                "as_of": "2026-06-17T00:00:00Z",
                "source": "manual_entry",
            },
        )
        bad_plan_step = types.GraphNode(
            type="PlanStep",
            tier="plan",
            attributes={
                "step_order": 1,
                "agent": "redemption_agent",
                "claim": "Transfer Chase points to Hyatt.",
                "inputs": [],
                "output": {"recommendation": "Transfer 120000 points."},
                "status": "active",
                "stale_reason": 42,
            },
        )
        bad_category = types.GraphNode(
            type="MerchantCategory",
            tier="world",
            attributes={"name": "Dining", "mcc_codes": [5812, "5814"]},
        )

        self.assertEqual(
            types.validate_node(bad_balance),
            ["Balance.attributes.amount_points must be int"],
        )
        self.assertEqual(
            types.validate_node(bad_plan_step),
            [
                "PlanStep.attributes.inputs must be object",
                "PlanStep.attributes.stale_reason must be str or null",
            ],
        )
        self.assertEqual(
            types.validate_node(bad_category),
            ["MerchantCategory.attributes.mcc_codes must be list[int]"],
        )

    def test_edge_validation_enforces_required_attribute_types(self):
        from schema import types

        valid_transfer = types.GraphEdge(
            type="TRANSFERS_TO",
            source_type="Program",
            target_type="Program",
            attributes={
                "ratio_num": 1,
                "ratio_den": 1,
                "transfer_time_days": 1,
                "is_active": True,
            },
        )
        bad_transfer = types.GraphEdge(
            type="TRANSFERS_TO",
            source_type="Program",
            target_type="Program",
            attributes={
                "ratio_num": "1",
                "ratio_den": 1,
                "is_active": "yes",
            },
        )
        bad_depends_on = types.GraphEdge(
            type="DEPENDS_ON",
            source_type="PlanStep",
            target_type="Balance",
            attributes={
                "observed_version": "0",
                "observed_property": 123,
            },
        )

        self.assertEqual(types.validate_edge(valid_transfer), [])
        self.assertEqual(
            types.validate_edge(bad_transfer),
            [
                "TRANSFERS_TO.attributes missing required field: transfer_time_days",
                "TRANSFERS_TO.attributes.ratio_num must be int",
                "TRANSFERS_TO.attributes.is_active must be bool",
            ],
        )
        self.assertEqual(
            types.validate_edge(bad_depends_on),
            [
                "DEPENDS_ON.attributes missing required field: observed_value",
                "DEPENDS_ON.attributes.observed_version must be int",
                "DEPENDS_ON.attributes.observed_property must be str or null",
            ],
        )

    def test_schema_sql_contains_mvp_tables_constraints_and_indexes(self):
        schema_sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")

        self.assertIn("CREATE TABLE nodes", schema_sql)
        self.assertIn("CREATE TABLE edges", schema_sql)
        self.assertIn("CREATE TABLE mutation_log", schema_sql)
        self.assertIn("'PlanStep'", schema_sql)
        self.assertIn("'DEPENDS_ON'", schema_sql)
        self.assertIn("nodes_attributes_gin_idx", schema_sql)
        self.assertIn("edges_unique_active_relationship", schema_sql)

    def test_schema_sql_defines_stale_plan_steps_view(self):
        schema_sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")

        self.assertIn("CREATE VIEW stale_plan_steps AS", schema_sql)
        self.assertIn("dep.type = 'DEPENDS_ON'", schema_sql)
        self.assertIn("plan_step.type = 'PlanStep'", schema_sql)
        self.assertIn(
            "depended_node.version <> (dep.attributes->>'observed_version')::integer",
            schema_sql,
        )

    def test_schema_sql_defines_mark_plan_step_stale_function(self):
        schema_sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")
        function_sql = schema_sql[
            schema_sql.index("CREATE FUNCTION mark_plan_step_stale") :
            schema_sql.index("CREATE FUNCTION update_node_optimistic")
        ]

        self.assertIn("CREATE FUNCTION mark_plan_step_stale", function_sql)
        self.assertIn("RETURNS TABLE (id UUID, version INTEGER)", function_sql)
        self.assertIn("jsonb_set(", function_sql)
        self.assertIn("'{status}'", function_sql)
        self.assertIn("'\"stale\"'::jsonb", function_sql)
        self.assertIn("'{stale_reason}'", function_sql)
        self.assertIn("version = version + 1", function_sql)
        self.assertIn("WHERE id = p_plan_step_id", function_sql)
        self.assertIn("AND type = 'PlanStep'", function_sql)
        self.assertIn("RETURNING id, version", function_sql)

    def test_schema_sql_defines_optimistic_concurrency_update_functions(self):
        schema_sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")

        self.assertIn("CREATE FUNCTION update_node_optimistic", schema_sql)
        self.assertIn("CREATE FUNCTION update_edge_optimistic", schema_sql)
        self.assertIn("p_expected_version INTEGER", schema_sql)
        self.assertIn("p_attributes JSONB", schema_sql)
        self.assertIn("WHERE id = p_node_id", schema_sql)
        self.assertIn("WHERE id = p_edge_id", schema_sql)
        self.assertIn("AND version = p_expected_version", schema_sql)
        self.assertIn("attributes = p_attributes", schema_sql)
        self.assertIn("version = version + 1", schema_sql)
        self.assertIn("RETURNS TABLE (id UUID, version INTEGER)", schema_sql)

    def test_schema_sql_defines_node_connectivity_violations_view(self):
        schema_sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")

        self.assertIn("CREATE VIEW node_connectivity_violations AS", schema_sql)
        self.assertIn("node_id", schema_sql)
        self.assertIn("node_type", schema_sql)
        self.assertIn("violation", schema_sql)
        self.assertIn("n.type = 'User'", schema_sql)
        self.assertIn("e.type IN ('FOR_USER', 'HOLDS', 'HAS_BALANCE', 'HAS_GOAL')", schema_sql)
        self.assertIn("n.type = 'Card'", schema_sql)
        self.assertIn("e.type IN ('HOLDS', 'ASSOCIATED_WITH', 'EARNS')", schema_sql)
        self.assertIn("n.type = 'Program'", schema_sql)
        self.assertIn("e.type IN ('ASSOCIATED_WITH', 'BALANCE_FOR', 'TRANSFERS_TO')", schema_sql)
        self.assertIn("n.type = 'MerchantCategory'", schema_sql)
        self.assertIn("e.type = 'EARNS'", schema_sql)
        self.assertIn("n.type = 'Balance'", schema_sql)
        self.assertIn("e.type = 'HAS_BALANCE'", schema_sql)
        self.assertIn("e.type = 'BALANCE_FOR'", schema_sql)
        self.assertIn("n.type = 'Goal'", schema_sql)
        self.assertIn("e.type IN ('HAS_GOAL', 'TARGETS')", schema_sql)
        self.assertIn("n.type = 'PlanQuery'", schema_sql)
        self.assertIn("e.type IN ('FOR_USER', 'TARGETS', 'STEP_OF')", schema_sql)
        self.assertIn("n.type = 'PlanStep'", schema_sql)
        self.assertIn("e.type = 'STEP_OF'", schema_sql)
        self.assertIn("e.type = 'DEPENDS_ON'", schema_sql)


if __name__ == "__main__":
    unittest.main()
