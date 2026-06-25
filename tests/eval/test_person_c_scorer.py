import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from benchmark.person_c_scorer import (
    invalidation_kind_for_case,
    report_passed,
    run_benchmark,
)


ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = ROOT / "fixtures" / "person-c-mvp-seed.json"
GOLD_CASES_PATH = ROOT / "benchmark" / "gold" / "person-c-mvp-cases.json"


def _load_gold_benchmark() -> dict:
    return json.loads(GOLD_CASES_PATH.read_text(encoding="utf-8"))


# Intended corpus contract — pinned here, independent of the fixture, so an
# accidental edit to the gold file (or its self-reported metadata) is caught
# rather than silently accepted.
EXPECTED_CASE_COUNT = 30
EXPECTED_AXIS_COUNTS = {
    "earning": 10,
    "redemption": 10,
    "portfolio": 10,
}
EXPECTED_INVALIDATION_TOTAL = 5


class PersonCScorerTests(unittest.TestCase):
    def test_report_scores_current_fixture_cleanly(self) -> None:
        report = run_benchmark()

        self.assertTrue(report_passed(report))
        self.assertEqual(report["architecture"], "typed_graph_fixture")
        self.assertEqual(report["case_count"], EXPECTED_CASE_COUNT)
        self.assertEqual(report["benchmark_axis_counts"], EXPECTED_AXIS_COUNTS)
        self.assertEqual(
            report["metric_definitions"]["strict_hallucination_rate"]["ticket"],
            "RCG-34",
        )
        self.assertEqual(
            report["metric_definitions"]["plan_invalidation_correctness"]["ticket"],
            "RCG-38",
        )
        self.assertEqual(report["metrics"]["accuracy_passed"], EXPECTED_CASE_COUNT)
        self.assertEqual(report["metrics"]["accuracy_total"], EXPECTED_CASE_COUNT)
        self.assertEqual(report["metrics"]["strict_hallucination_count"], 0)
        self.assertEqual(report["metrics"]["strict_hallucination_case_count"], 0)
        self.assertEqual(report["metrics"]["strict_hallucination_issue_counts"], {})
        self.assertEqual(report["metrics"]["invalidation_passed"], EXPECTED_INVALIDATION_TOTAL)
        self.assertEqual(report["metrics"]["invalidation_total"], EXPECTED_INVALIDATION_TOTAL)
        self.assertEqual(
            report["metrics"]["invalidation_wins_by_kind"],
            {
                "balance_drop_to_backup_award": {
                    "passed": 2,
                    "total": 2,
                    "rate": 1.0,
                    "case_ids": [
                        "mvp_004_balance_change_replan",
                        "mvp_026_spend_to_shinjuku_threshold",
                    ],
                },
                "balance_drop_to_cash_fallback": {
                    "passed": 1,
                    "total": 1,
                    "rate": 1.0,
                    "case_ids": ["mvp_005_second_balance_change_no_award"],
                },
                "balance_drop_to_lower_tier_award": {
                    "passed": 2,
                    "total": 2,
                    "rate": 1.0,
                    "case_ids": [
                        "mvp_025_large_spend_replan_to_ueno",
                        "mvp_027_backup_plan_stales_to_ueno",
                    ],
                },
            },
        )
        self.assertEqual(len(report["cases"]), EXPECTED_CASE_COUNT)

    def test_gold_corpus_has_30_unique_cases_across_required_axes(self) -> None:
        benchmark = _load_gold_benchmark()
        case_ids = [case["case_id"] for case in benchmark["cases"]]
        axis_counts: dict[str, int] = {}
        invalidation_kinds: dict[str, int] = {}
        for case in benchmark["cases"]:
            axis = case["benchmark_axis"]
            axis_counts[axis] = axis_counts.get(axis, 0) + 1
            self.assertIn("query", case)
            self.assertIn("starting_balance_points", case)
            self.assertTrue(
                "expected_top_award_slug" in case
                or "expected_fallback" in case
                or "expected_response" in case
            )
            if "mutation" in case:
                kind = case["invalidation_kind"]
                invalidation_kinds[kind] = invalidation_kinds.get(kind, 0) + 1

        self.assertEqual(len(case_ids), EXPECTED_CASE_COUNT)
        self.assertEqual(len(case_ids), len(set(case_ids)))
        # Actual case distribution must hit the pinned contract...
        self.assertEqual(axis_counts, EXPECTED_AXIS_COUNTS)
        # ...and the file's self-reported metadata must match it too, so the two
        # can't drift apart silently.
        self.assertEqual(
            benchmark["scoring_rules"]["expected_axis_counts"], EXPECTED_AXIS_COUNTS
        )
        self.assertEqual(benchmark["fixture_manifest"]["ticket"], "RCG-31")
        self.assertEqual(benchmark["fixture_manifest"]["query_count"], EXPECTED_CASE_COUNT)
        self.assertEqual(
            invalidation_kinds,
            {
                "balance_drop_to_backup_award": 2,
                "balance_drop_to_cash_fallback": 1,
                "balance_drop_to_lower_tier_award": 2,
            },
        )

    def test_invalidation_cases_record_stale_steps(self) -> None:
        report = run_benchmark()
        invalidation_cases = [
            case
            for case in report["cases"]
            if case["invalidation_correct"] is not None
        ]

        self.assertEqual(len(invalidation_cases), EXPECTED_INVALIDATION_TOTAL)
        for case in invalidation_cases:
            self.assertTrue(case["invalidation_correct"])
            self.assertGreaterEqual(len(case["stale_step_orders"]), 1)

    def test_invalidation_scoring_uses_balance_slug_not_fixture_order(self) -> None:
        fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        fixture["balances"].insert(
            0,
            {
                "slug": "balance:user_mvp_demo:unrelated_points",
                "user_slug": "user:mvp_demo",
                "program_slug": "program:unrelated",
                "balance_points": 999999,
                "version": 7,
                "as_of": fixture["as_of"],
                "source": "manual_entry",
                "node_type": "UserBalance",
            },
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            fixture_path = Path(temp_dir) / "fixture.json"
            fixture_path.write_text(json.dumps(fixture), encoding="utf-8")
            report = run_benchmark(fixture_path=fixture_path)

        self.assertTrue(report_passed(report))
        self.assertEqual(report["metrics"]["invalidation_passed"], EXPECTED_INVALIDATION_TOTAL)
        self.assertEqual(report["metrics"]["invalidation_total"], EXPECTED_INVALIDATION_TOTAL)

    def test_invalidation_kind_required_on_mutation_cases(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalidation_kind"):
            invalidation_kind_for_case(
                {"case_id": "bad_case", "mutation": {"delta_points": -1}}
            )

    def test_invalidation_kind_optional_on_non_mutation_cases(self) -> None:
        self.assertIsNone(invalidation_kind_for_case({"case_id": "plain"}))

    def test_cli_emits_json_report(self) -> None:
        completed = subprocess.run(
            [sys.executable, "-m", "benchmark.person_c_scorer"],
            check=True,
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        report = json.loads(completed.stdout)

        self.assertTrue(report_passed(report))
        self.assertEqual(report["benchmark_id"], "person-c-mvp-redemption-v1")


if __name__ == "__main__":
    unittest.main()
