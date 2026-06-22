import copy
import unittest
from pathlib import Path

from agents.redemption.planner import (
    apply_balance_delta,
    find_stale_steps_for_balance,
    load_fixture,
    plan_redemption,
    value_basis_points,
)
from agents.redemption.award_tool import search_seed_awards


ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = ROOT / "fixtures" / "person-c-mvp-seed.json"
BENCHMARK_PATH = ROOT / "benchmark" / "gold" / "person-c-mvp-cases.json"


class PersonCRedemptionPlannerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = load_fixture(FIXTURE_PATH)
        self.benchmark = load_fixture(BENCHMARK_PATH)

    def test_initial_plan_picks_ginza_with_dependencies(self) -> None:
        plan = plan_redemption(self.fixture)

        self.assertEqual(plan["chosen_award_slug"], "award:demo_hyatt_ginza:tokyo:3n")
        self.assertEqual(plan["backup_award_slug"], "award:demo_hyatt_shinjuku:tokyo:3n")
        self.assertEqual(plan["ranked_awards"][0]["value_basis_points"], 23333)
        self.assertEqual(plan["ranked_awards"][1]["value_basis_points"], 18000)
        self.assertEqual([step["step_order"] for step in plan["steps"]], [1, 2, 3])

        for step in plan["steps"]:
            dependencies = step["state_dependencies"]
            self.assertGreaterEqual(len(dependencies), 1)
            dependency = dependencies[0]
            self.assertEqual(dependency["target_table"], "user_balances")
            self.assertEqual(dependency["target_node_type"], "UserBalance")
            self.assertEqual(dependency["observed_version"], 1)
            self.assertEqual(dependency["snapshot_value"]["balance_points"], 75000)

    def test_balance_change_stales_old_steps_and_replans_to_shinjuku(self) -> None:
        original_plan = plan_redemption(self.fixture)
        updated_fixture = apply_balance_delta(
            self.fixture,
            "balance:user_mvp_demo:chase_ur",
            -40000,
        )
        updated_balance = updated_fixture["balances"][0]

        stale_steps = find_stale_steps_for_balance(original_plan, updated_balance)
        self.assertEqual([step["step_order"] for step in stale_steps], [1, 2, 3])

        replanned = plan_redemption(updated_fixture)
        self.assertEqual(replanned["balance_points"], 35000)
        self.assertEqual(replanned["chosen_award_slug"], "award:demo_hyatt_shinjuku:tokyo:3n")
        self.assertNotIn(
            "award:demo_hyatt_ginza:tokyo:3n",
            [candidate["award_slug"] for candidate in replanned["ranked_awards"]],
        )

    def test_low_balance_uses_cash_fallback_without_inventing_awards(self) -> None:
        plan = plan_redemption(self.fixture, balance_points=20000)

        self.assertIsNone(plan["chosen_award_slug"])
        self.assertEqual(plan["fallback"], "cash")
        self.assertEqual(plan["ranked_awards"], [])
        self.assertTrue(
            all("unaffordable" in option["reasons"] for option in plan["rejected_options"])
        )

    def test_cash_fallback_rejections_stay_scoped_to_query_awards(self) -> None:
        fixture = copy.deepcopy(self.fixture)
        fixture["award_options"].append(
            {
                "slug": "award:irrelevant_hyatt:kyoto:1n",
                "hotel_slug": "hotel:irrelevant_hyatt",
                "program_slug": "program:hyatt",
                "city": "Kyoto",
                "nights": 1,
                "available": True,
                "points_total": 5000,
                "cash_total_cents": 10000,
                "value_basis_points": 20000,
                "cash_quote_slug": "quote:cash:irrelevant_hyatt:kyoto:1n",
                "source_tool": "seed_award_search",
                "fetched_at": self.fixture["as_of"],
            }
        )

        plan = plan_redemption(fixture, balance_points=20000)

        rejected_slugs = {option["award_slug"] for option in plan["rejected_options"]}
        self.assertEqual(
            rejected_slugs,
            {
                "award:demo_hyatt_ginza:tokyo:3n",
                "award:demo_hyatt_shinjuku:tokyo:3n",
                "award:demo_hyatt_ueno:tokyo:3n",
            },
        )

    def test_award_overrides_filter_unavailable_options(self) -> None:
        plan = plan_redemption(
            self.fixture,
            overrides={
                "award:demo_hyatt_ginza:tokyo:3n": {
                    "available": False,
                }
            },
        )

        self.assertEqual(plan["chosen_award_slug"], "award:demo_hyatt_shinjuku:tokyo:3n")
        self.assertNotIn(
            "award:demo_hyatt_ginza:tokyo:3n",
            [candidate["award_slug"] for candidate in plan["ranked_awards"]],
        )

    def test_fixture_uses_integer_basis_point_value_math(self) -> None:
        for award in self.fixture["award_options"]:
            self.assertIsInstance(award["value_basis_points"], int)
            self.assertEqual(
                award["value_basis_points"],
                value_basis_points(award["cash_total_cents"], award["points_total"]),
            )
            self.assertNotIn("cents_per_point", award)

    def test_seed_award_tool_returns_typed_graph_fragment(self) -> None:
        fragment = search_seed_awards(
            self.fixture,
            city="Tokyo",
            nights=3,
            program_slug="program:hyatt",
        )

        self.assertEqual(fragment["source_tool"], "seed_award_search")
        self.assertEqual(len(fragment["edges"]), 3)
        self.assertEqual(
            {node["node_type"] for node in fragment["nodes"]},
            {"RedemptionOption", "ExternalQuote"},
        )
        self.assertEqual(
            {
                node["quote_type"]
                for node in fragment["nodes"]
                if node["node_type"] == "ExternalQuote"
            },
            {"award_availability", "cash_price"},
        )
        for node in fragment["nodes"]:
            if node["node_type"] == "ExternalQuote":
                self.assertEqual(node["source_tool"], "seed_award_search")
                self.assertIn("fetched_at", node)

    def test_benchmark_cases_are_executable_against_fixture(self) -> None:
        expected_by_case = {
            "mvp_001_initial_best_value": ("award:demo_hyatt_ginza:tokyo:3n", None, "current"),
            "mvp_002_affordability_filter_35k": ("award:demo_hyatt_shinjuku:tokyo:3n", None, "current"),
            "mvp_003_low_balance_cash_fallback": (None, "cash", "current"),
            "mvp_004_balance_change_replan": ("award:demo_hyatt_shinjuku:tokyo:3n", None, "current"),
            "mvp_005_second_balance_change_no_award": (None, "cash", "current"),
            "mvp_006_wrong_program_trap": (None, None, "unsupported"),
            "mvp_007_wrong_ratio_trap": ("award:demo_hyatt_ginza:tokyo:3n", None, "current"),
            "mvp_008_unavailable_top_option": ("award:demo_hyatt_shinjuku:tokyo:3n", None, "current"),
            "mvp_009_all_awards_unavailable": (None, "cash", "current"),
            "mvp_010_explanation_quality": ("award:demo_hyatt_ginza:tokyo:3n", None, "current"),
            "mvp_011_baseline_output_sink": ("award:demo_hyatt_ginza:tokyo:3n", None, "current"),
        }

        for case in self.benchmark["cases"]:
            with self.subTest(case_id=case["case_id"]):
                fixture = self.fixture
                if "mutation" in case:
                    fixture = copy.deepcopy(self.fixture)
                    fixture["balances"][0]["balance_points"] = case["starting_balance_points"]
                    fixture = apply_balance_delta(
                        fixture,
                        "balance:user_mvp_demo:chase_ur",
                        case["mutation"]["delta_points"],
                    )

                plan = plan_redemption(
                    fixture,
                    balance_points=case.get("starting_balance_points")
                    if "mutation" not in case
                    else None,
                    query_text=case["query"],
                    overrides=case.get("overrides"),
                )
                expected_award, expected_fallback, expected_status = expected_by_case[case["case_id"]]

                self.assertEqual(plan["status"], expected_status)
                self.assertEqual(plan["chosen_award_slug"], expected_award)
                self.assertEqual(plan.get("fallback"), expected_fallback)


if __name__ == "__main__":
    unittest.main()
