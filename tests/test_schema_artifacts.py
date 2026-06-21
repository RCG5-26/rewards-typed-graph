import json
import pathlib
import subprocess
import sys
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_SQL_PATH = REPO_ROOT / "schema" / "schema.sql"
SCHEMA_CONTRACT_PATH = REPO_ROOT / "schema" / "contracts" / "graph.schema.json"
GENERATED_PYTHON_TYPES_PATH = REPO_ROOT / "schema" / "generated" / "types.py"
GENERATED_TYPESCRIPT_TYPES_PATH = REPO_ROOT / "schema" / "generated" / "types.ts"
GENERATE_SCHEMA_TYPES_PATH = REPO_ROOT / "scripts" / "generate_schema_types.py"


class SchemaArtifactsTest(unittest.TestCase):
    def test_schema_contract_is_canonical_source_for_generated_types(self):
        contract = json.loads(SCHEMA_CONTRACT_PATH.read_text(encoding="utf-8"))

        self.assertEqual(contract["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertEqual(contract["title"], "Rewards Typed Graph MVP Contract")
        self.assertIn("nodeTypes", contract["$defs"])
        self.assertIn("edgeTypes", contract["$defs"])
        self.assertEqual(
            tuple(contract["$defs"]["nodeTypes"]["enum"]),
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
        self.assertEqual(contract["x-graph"]["nodeTiers"]["Balance"], "personal")
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
                "plan_lineage_id": "plan-lineage-1",
                "revision_number": 1,
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

    def test_plan_query_statuses_are_restricted_from_plan_step_statuses(self):
        from schema import types

        plan_query = types.GraphNode(
            type="PlanQuery",
            tier="plan",
            attributes={
                "plan_lineage_id": "plan-lineage-1",
                "revision_number": 1,
                "query_text": "Find the best Tokyo redemption.",
                "status": "stale",
            },
        )
        plan_step = types.GraphNode(
            type="PlanStep",
            tier="plan",
            attributes={
                "plan_lineage_id": "plan-lineage-1",
                "revision_number": 1,
                "step_order": 1,
                "agent": "redemption_agent",
                "claim": "Transfer Chase points to Hyatt.",
                "inputs": {},
                "output": {},
                "status": "stale",
            },
        )

        self.assertEqual(
            types.validate_node(plan_query),
            [
                "PlanQuery.attributes.status must be one of "
                "('active', 'completed', 'failed')"
            ],
        )
        self.assertEqual(types.validate_node(plan_step), [])

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
        self.assertIn("balance_one_per_user_program_unique", schema_sql)
        self.assertIn("ON nodes (user_id, (attributes->>'program_id'))", schema_sql)
        self.assertIn("WHERE type = 'Balance'", schema_sql)

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
        self.assertIn("AND COALESCE(attributes->>'status', '') NOT IN (", function_sql)
        self.assertIn("'stale'", function_sql)
        self.assertIn("'superseded'", function_sql)
        self.assertIn("'completed'", function_sql)
        self.assertIn("'failed'", function_sql)
        self.assertIn("RETURNING id, version", function_sql)

    def test_schema_sql_defines_supersede_plan_step_function(self):
        schema_sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")
        function_sql = schema_sql[
            schema_sql.index("CREATE FUNCTION supersede_plan_step") :
            schema_sql.index("CREATE FUNCTION update_node_optimistic")
        ]

        self.assertIn("CREATE FUNCTION supersede_plan_step", function_sql)
        self.assertIn("p_source_plan_step_id UUID", function_sql)
        self.assertIn("p_successor_attributes JSONB", function_sql)
        self.assertIn("FOR UPDATE", function_sql)
        self.assertIn("COALESCE(source_step.attributes->>'status', '') <> 'stale'", function_sql)
        self.assertIn("INSERT INTO nodes (type, tier, user_id, slug, attributes, version)", function_sql)
        self.assertIn("'PlanStep'", function_sql)
        self.assertIn("'{status}'", function_sql)
        self.assertIn("'\"superseded\"'::jsonb", function_sql)
        self.assertIn("'{superseded_by_plan_step_id}'", function_sql)
        self.assertIn("RETURN NEXT", function_sql)

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
