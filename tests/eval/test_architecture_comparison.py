import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

from benchmark.architecture_comparison import (
    REQUIRED_ARCHITECTURES,
    build_architecture_comparison,
)


ROOT = Path(__file__).resolve().parents[2]
CASE_IDS = ["mvp_001_initial_best_value", "mvp_004_balance_change_replan"]


def _report(
    architecture: str,
    *,
    accuracy_passed: int,
    hallucination_count: int,
    invalidation_passed: int,
    token_cost_total: int | None,
) -> dict[str, Any]:
    metrics = {
        "accuracy_passed": accuracy_passed,
        "accuracy_total": 2,
        "accuracy_rate": accuracy_passed / 2,
        "strict_hallucination_count": hallucination_count,
        "strict_hallucination_case_count": hallucination_count,
        "strict_hallucination_rate": hallucination_count / 2,
        "invalidation_passed": invalidation_passed,
        "invalidation_total": 1,
        "invalidation_rate": invalidation_passed / 1,
    }
    if token_cost_total is not None:
        metrics["token_cost_total"] = token_cost_total
    return {
        "benchmark_id": "person-c-mvp-redemption-v1",
        "fixture_id": "person-c-mvp-tokyo-hyatt-v1",
        "architecture": architecture,
        "evaluator_version": f"{architecture}-test",
        "case_count": 2,
        "metrics": metrics,
        "cases": [
            {
                "case_id": CASE_IDS[0],
                "accuracy_correct": accuracy_passed >= 1,
                "hallucination_count": 1 if hallucination_count >= 1 else 0,
                "invalidation_correct": None,
            },
            {
                "case_id": CASE_IDS[1],
                "accuracy_correct": accuracy_passed == 2,
                "hallucination_count": 1 if hallucination_count == 2 else 0,
                "invalidation_correct": bool(invalidation_passed),
            },
        ],
    }


def _all_reports() -> list[dict[str, Any]]:
    return [
        _report(
            "typed_graph_fixture",
            accuracy_passed=2,
            hallucination_count=0,
            invalidation_passed=1,
            token_cost_total=None,
        ),
        _report(
            "single_agent_llm_baseline",
            accuracy_passed=1,
            hallucination_count=1,
            invalidation_passed=0,
            token_cost_total=320,
        ),
        _report(
            "free_text_multiagent_baseline",
            accuracy_passed=1,
            hallucination_count=2,
            invalidation_passed=0,
            token_cost_total=980,
        ),
    ]


class ArchitectureComparisonTests(unittest.TestCase):
    def test_builds_three_architecture_summary_with_required_metrics(self) -> None:
        comparison = build_architecture_comparison(_all_reports())

        self.assertEqual(comparison["benchmark_id"], "person-c-mvp-redemption-v1")
        self.assertEqual(comparison["required_architectures"], list(REQUIRED_ARCHITECTURES))
        self.assertEqual(comparison["architecture_count"], 3)
        self.assertEqual(
            set(comparison["architectures"]),
            {
                "typed_graph_fixture",
                "single_agent_llm_baseline",
                "free_text_multiagent_baseline",
            },
        )
        typed = comparison["architectures"]["typed_graph_fixture"]
        self.assertEqual(typed["accuracy_rate"], 1.0)
        self.assertEqual(typed["strict_hallucination_rate"], 0.0)
        self.assertEqual(typed["invalidation_rate"], 1.0)
        self.assertEqual(typed["token_cost_total"], 0)
        free_text = comparison["architectures"]["free_text_multiagent_baseline"]
        self.assertEqual(free_text["token_cost_total"], 980)
        self.assertEqual(len(comparison["case_matrix"]), 2)
        self.assertEqual(
            list(comparison["case_matrix"][0]["architectures"]),
            list(REQUIRED_ARCHITECTURES),
        )
        self.assertEqual(
            comparison["case_matrix"][1]["architectures"]["free_text_multiagent_baseline"],
            {
                "accuracy_correct": False,
                "hallucination_count": 1,
                "invalidation_correct": False,
            },
        )

    def test_requires_all_three_architectures(self) -> None:
        with self.assertRaisesRegex(ValueError, "missing architecture reports"):
            build_architecture_comparison(_all_reports()[:2])

    def test_rejects_mismatched_case_sets(self) -> None:
        reports = _all_reports()
        reports[2]["cases"][1]["case_id"] = "different_case"

        with self.assertRaisesRegex(ValueError, "case ids"):
            build_architecture_comparison(reports)

    def test_rejects_duplicate_case_ids_before_building_matrix(self) -> None:
        reports = _all_reports()
        reports[0]["cases"][1]["case_id"] = reports[0]["cases"][0]["case_id"]

        with self.assertRaisesRegex(ValueError, "duplicate case_id"):
            build_architecture_comparison(reports)

    def test_cli_combines_report_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            paths = []
            for index, report in enumerate(_all_reports()):
                path = Path(temp_dir) / f"report-{index}.json"
                path.write_text(json.dumps(report), encoding="utf-8")
                paths.append(path)

            completed = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "benchmark.architecture_comparison",
                    "--typed-report",
                    str(paths[0]),
                    "--single-agent-report",
                    str(paths[1]),
                    "--free-text-report",
                    str(paths[2]),
                ],
                check=True,
                cwd=ROOT,
                capture_output=True,
                text=True,
            )

        comparison = json.loads(completed.stdout)
        self.assertEqual(comparison["architecture_count"], 3)
        self.assertEqual(
            comparison["architectures"]["single_agent_llm_baseline"]["token_cost_total"],
            320,
        )


if __name__ == "__main__":
    unittest.main()
