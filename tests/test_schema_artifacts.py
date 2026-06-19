import pathlib
import unittest


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

    def test_schema_sql_contains_mvp_tables_constraints_and_indexes(self):
        schema_sql = pathlib.Path("schema/schema.sql").read_text(encoding="utf-8")

        self.assertIn("CREATE TABLE nodes", schema_sql)
        self.assertIn("CREATE TABLE edges", schema_sql)
        self.assertIn("CREATE TABLE mutation_log", schema_sql)
        self.assertIn("'PlanStep'", schema_sql)
        self.assertIn("'DEPENDS_ON'", schema_sql)
        self.assertIn("nodes_attributes_gin_idx", schema_sql)
        self.assertIn("edges_unique_active_relationship", schema_sql)


if __name__ == "__main__":
    unittest.main()
