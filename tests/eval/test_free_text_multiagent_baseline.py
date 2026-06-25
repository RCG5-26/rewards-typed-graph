import json
import subprocess
import sys
import unittest
from pathlib import Path
from typing import Any

from benchmark.free_text_multiagent_baseline import (
    report_completed,
    run_free_text_multiagent_baseline,
)


ROOT = Path(__file__).resolve().parents[2]


def _contains_key(value: Any, key: str) -> bool:
    if isinstance(value, dict):
        return key in value or any(_contains_key(item, key) for item in value.values())
    if isinstance(value, list):
        return any(_contains_key(item, key) for item in value)
    return False


class FreeTextMultiAgentBaselineTests(unittest.TestCase):
    def test_report_uses_same_cases_with_baseline_plan_type(self) -> None:
        report = run_free_text_multiagent_baseline()

        self.assertTrue(report_completed(report))
        self.assertEqual(report["architecture"], "free_text_multiagent_baseline")
        self.assertEqual(report["plan_type"], "baseline_free_text_multiagent")
        self.assertEqual(report["metrics"]["accuracy_passed"], 11)
        self.assertEqual(report["metrics"]["accuracy_total"], 11)
        self.assertEqual(report["metrics"]["strict_hallucination_count"], 0)
        self.assertEqual(report["metrics"]["invalidation_passed"], 0)
        self.assertEqual(report["metrics"]["invalidation_total"], 2)
        self.assertEqual(len(report["cases"]), 11)

    def test_baseline_output_is_final_plan_only_without_graph_dependencies(self) -> None:
        report = run_free_text_multiagent_baseline()

        for case in report["cases"]:
            with self.subTest(case_id=case["case_id"]):
                raw_output = case["raw_output"]
                self.assertEqual(raw_output["coordination_mode"], "free_text_messages")
                self.assertEqual(raw_output["tool_output_mode"], "json")
                self.assertEqual(raw_output["persistence_shape"], ["plans", "evaluations"])
                self.assertTrue(raw_output["final_plan_only"])
                for forbidden_key in (
                    "state_dependencies",
                    "plan_steps",
                    "graph_mutations",
                    "agent_runs",
                ):
                    self.assertFalse(_contains_key(raw_output, forbidden_key), forbidden_key)

    def test_invalidation_cases_replan_but_do_not_get_structural_credit(self) -> None:
        report = run_free_text_multiagent_baseline()
        invalidation_cases = [
            case
            for case in report["cases"]
            if case["invalidation_correct"] is not None
        ]

        self.assertEqual(len(invalidation_cases), 2)
        for case in invalidation_cases:
            self.assertFalse(case["invalidation_correct"])
            self.assertEqual(case["stale_step_orders"], [])
            self.assertEqual(case["actual_top_award_slug"], case["expected_top_award_slug"])

    def test_case_overrides_are_visible_in_json_tool_outputs(self) -> None:
        report = run_free_text_multiagent_baseline()
        unavailable_case = next(
            case
            for case in report["cases"]
            if case["case_id"] == "mvp_008_unavailable_top_option"
        )
        awards = unavailable_case["raw_output"]["tool_outputs"]["award_search"]["awards"]
        ginza = next(
            award
            for award in awards
            if award["award_slug"] == "award:demo_hyatt_ginza:tokyo:3n"
        )

        self.assertFalse(ginza["available"])
        self.assertEqual(
            unavailable_case["actual_top_award_slug"],
            "award:demo_hyatt_shinjuku:tokyo:3n",
        )

    def test_cli_emits_json_report(self) -> None:
        completed = subprocess.run(
            [sys.executable, "-m", "benchmark.free_text_multiagent_baseline"],
            check=True,
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        report = json.loads(completed.stdout)

        self.assertTrue(report_completed(report))
        self.assertEqual(report["architecture"], "free_text_multiagent_baseline")


if __name__ == "__main__":
    unittest.main()
