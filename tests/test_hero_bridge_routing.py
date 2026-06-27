"""Routing tests for ``hero_bridge.do_create_plan``.

``do_create_plan`` chooses the World of Hyatt direct-redemption planner when
``card:world_of_hyatt`` is in ``card_slugs`` and the Chase UR transfer planner
otherwise. These tests pin that branch selection without touching Postgres.
"""

import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import MagicMock, patch


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
BRIDGE_PATH = REPO_ROOT / "apps" / "api" / "bridge" / "hero_bridge.py"


def _load_bridge_module():
    spec = importlib.util.spec_from_file_location("hero_bridge_routing_test", BRIDGE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load hero_bridge.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class DoCreatePlanRoutingTest(unittest.TestCase):
    def setUp(self):
        self.bridge = _load_bridge_module()

    def _run(self, card_slugs):
        snapshot = MagicMock(plan_id="plan-123")
        with (
            patch.object(self.bridge, "_PsqlConnection", MagicMock()),
            patch.object(self.bridge, "create_plan_from_query", return_value=snapshot) as transfer,
            patch.object(
                self.bridge, "create_direct_plan_from_query", return_value=snapshot
            ) as direct,
            patch.object(self.bridge, "project_plan", return_value={"planId": "plan-123"}),
        ):
            result = self.bridge.do_create_plan("user-1", "best Hyatt redemption", card_slugs)
        return result, transfer, direct

    def test_routes_to_direct_planner_for_world_of_hyatt(self):
        result, transfer, direct = self._run(["card:world_of_hyatt"])

        direct.assert_called_once()
        transfer.assert_not_called()
        self.assertEqual(result, {"planId": "plan-123"})

    def test_routes_to_transfer_planner_without_hyatt_card(self):
        _, transfer, direct = self._run(["card:chase_sapphire_preferred"])

        transfer.assert_called_once()
        direct.assert_not_called()

    def test_routes_to_direct_planner_when_hyatt_is_one_of_several_cards(self):
        # Membership-based routing: the Hyatt card alongside others still wins.
        _, transfer, direct = self._run(
            ["card:chase_sapphire_preferred", "card:world_of_hyatt"]
        )

        direct.assert_called_once()
        transfer.assert_not_called()

    def test_routes_to_transfer_planner_when_card_slugs_is_none(self):
        _, transfer, direct = self._run(None)

        transfer.assert_called_once()
        direct.assert_not_called()


if __name__ == "__main__":
    unittest.main()
