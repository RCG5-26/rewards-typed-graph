import importlib.util
import json
import pathlib
import sys
import unittest
from unittest.mock import patch


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BRIDGE_PATH = REPO_ROOT / "apps" / "api" / "bridge" / "hero_bridge.py"


def _load_bridge_module():
    spec = importlib.util.spec_from_file_location("hero_bridge_projection_test", BRIDGE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load hero_bridge.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class HeroBridgeProjectionTest(unittest.TestCase):
    def test_project_plan_exposes_graph_for_cloned_dependency_ids(self):
        bridge = _load_bridge_module()
        cloned_balance_id = "99999999-9999-9999-9999-99999999d001"

        transfer_payload = {
            "action": "Transfer 45,000 Chase Ultimate Rewards points to World of Hyatt.",
            "reasoning": "The cloned Chase balance supports the Hyatt transfer.",
            "planner_payload": {
                "source_program_slug": "program:chase_ur",
                "dest_program_slug": "program:hyatt",
                "transfer_ratio_basis_points": 10000,
            },
        }
        redemption_payload = {
            "action": "Book Demo Hyatt Ginza for 45,000 Hyatt points.",
            "reasoning": "The seeded award is the best-value Tokyo option.",
            "planner_payload": {
                "award_slug": "award:demo_hyatt_ginza:tokyo:3n",
                "hotel_name": "Demo Hyatt Ginza",
                "candidate_fact_slugs": [
                    "transfer:chase_ur:hyatt",
                    "award:demo_hyatt_ginza:tokyo:3n",
                ],
            },
        }
        dependencies_by_step = {
            "step-1": [
                {
                    "id": cloned_balance_id,
                    "kind": "UserBalance",
                    "table": "user_balances",
                    "slug": "program:chase_ur",
                    "label": "Chase Ultimate Rewards",
                    "programId": "program-id-chase",
                }
            ]
        }
        programs_by_slug = {
            "program:chase_ur": {
                "programId": "program-id-chase",
                "label": "Chase Ultimate Rewards",
            },
            "program:hyatt": {
                "programId": "program-id-hyatt",
                "label": "World of Hyatt",
            },
        }

        def rows_for(sql):
            if "FROM plans" in sql and "query_text" in sql:
                return [("lineage-1", 1, "current", "Tokyo?", "Use Hyatt.")]
            if "FROM plan_steps" in sql and "payload::text" in sql:
                return [
                    (
                        "step-1",
                        1,
                        "transfer_recommendation",
                        "current",
                        json.dumps(transfer_payload),
                        transfer_payload["action"],
                        transfer_payload["reasoning"],
                    ),
                    (
                        "step-2",
                        2,
                        "redemption_recommendation",
                        "current",
                        json.dumps(redemption_payload),
                        redemption_payload["action"],
                        redemption_payload["reasoning"],
                    ),
                ]
            return []

        with (
            patch.object(bridge, "_psql_rows", side_effect=rows_for),
            patch.object(
                bridge,
                "_dependencies_by_step",
                return_value=dependencies_by_step,
            ),
            patch.object(
                bridge,
                "_program_by_slug",
                side_effect=lambda slug: programs_by_slug.get(
                    slug, {"programId": None, "label": None}
                ),
            ),
        ):
            plan = bridge.project_plan("user-1", "plan-1")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan["steps"][0]["dependsOn"], [cloned_balance_id])
        self.assertEqual(plan["steps"][0]["dependencies"][0]["slug"], "program:chase_ur")
        self.assertEqual(plan["steps"][0]["dependencies"][0]["label"], "Chase Ultimate Rewards")

        nodes = {node["id"]: node for node in plan["graph"]["nodes"]}
        self.assertIn("program:chase_ur", nodes)
        self.assertIn("program:hyatt", nodes)
        self.assertIn("award:demo_hyatt_ginza:tokyo:3n", nodes)
        self.assertEqual(nodes["program:chase_ur"]["programId"], "program-id-chase")

        edges = {edge["id"]: edge for edge in plan["graph"]["edges"]}
        self.assertEqual(
            edges["transfer:chase_ur:hyatt"],
            {
                "id": "transfer:chase_ur:hyatt",
                "from": "program:chase_ur",
                "to": "program:hyatt",
                "kind": "transfer",
            },
        )
        self.assertEqual(edges["redeem:program:hyatt->award:demo_hyatt_ginza:tokyo:3n"]["kind"], "redeem")


if __name__ == "__main__":
    unittest.main()
