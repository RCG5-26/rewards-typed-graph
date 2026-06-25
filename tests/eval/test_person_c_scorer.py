import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from benchmark.person_c_scorer import report_passed, run_benchmark


ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = ROOT / "fixtures" / "person-c-mvp-seed.json"
GOLD_CASES_PATH = ROOT / "benchmark" / "gold" / "person-c-mvp-cases.json"


def _load_gold_benchmark() -> dict:
    return json.loads(GOLD_CASES_PATH.read_text(encoding="utf-8"))


_GOLD_BENCHMARK = _load_gold_benchmark()
GOLD_CASE_COUNT = len(_GOLD_BENCHMARK["cases"])
GOLD_EXPECTED_AXIS_COUNTS = _GOLD_BENCHMARK["scoring_rules"]["expected_axis_counts"]
GOLD_INVALIDATION_TOTAL = sum(
    1 for case in _GOLD_BENCHMARK["cases"] if "mutation" in case
)


class PersonCScorerTests(unittest.TestCase):
    def test_report_scores_current_fixture_cleanly(self) -> None:
        report = run_benchmark()

        self.assertTrue(report_passed(report))
        self.assertEqual(report["architecture"], "typed_graph_fixture")
        self.assertEqual(report["case_count"], GOLD_CASE_COUNT)
        self.assertEqual(report["benchmark_axis_counts"], GOLD_EXPECTED_AXIS_COUNTS)
        self.assertEqual(report["metrics"]["accuracy_passed"], GOLD_CASE_COUNT)
        self.assertEqual(report["metrics"]["accuracy_total"], GOLD_CASE_COUNT)
        self.assertEqual(report["metrics"]["strict_hallucination_count"], 0)
        self.assertEqual(report["metrics"]["invalidation_passed"], GOLD_INVALIDATION_TOTAL)
        self.assertEqual(report["metrics"]["invalidation_total"], GOLD_INVALIDATION_TOTAL)
        self.assertEqual(len(report["cases"]), GOLD_CASE_COUNT)

    def test_gold_corpus_has_30_unique_cases_across_required_axes(self) -> None:
        benchmark = _load_gold_benchmark()
        case_ids = [case["case_id"] for case in benchmark["cases"]]
        axis_counts: dict[str, int] = {}
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

        self.assertEqual(len(case_ids), GOLD_CASE_COUNT)
        self.assertEqual(len(case_ids), len(set(case_ids)))
        self.assertEqual(axis_counts, benchmark["scoring_rules"]["expected_axis_counts"])

    def test_invalidation_cases_record_stale_steps(self) -> None:
        report = run_benchmark()
        invalidation_cases = [
            case
            for case in report["cases"]
            if case["invalidation_correct"] is not None
        ]

        self.assertEqual(len(invalidation_cases), GOLD_INVALIDATION_TOTAL)
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
        self.assertEqual(report["metrics"]["invalidation_passed"], GOLD_INVALIDATION_TOTAL)
        self.assertEqual(report["metrics"]["invalidation_total"], GOLD_INVALIDATION_TOTAL)

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
