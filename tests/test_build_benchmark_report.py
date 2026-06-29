"""Tests for scripts/build_benchmark_report.py (PR #52 follow-up).

This script owns the frontend report contract (`not_run` fallbacks, invalid-JSON
handling, architecture validation, normalized metric shape). CodeRabbit flagged
it as a producer with no direct test — these cover `_normalize`, `_load_baseline`,
and `build` so the contract can't drift unnoticed. The typed-graph branch of
`build()` runs the real fixture-backed scorer (deterministic, no API key).
"""

from __future__ import annotations

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[1]


def _repo_temp_reports_dir() -> "tempfile.TemporaryDirectory[str]":
    # REPORTS_DIR is always inside the repo in real use (the builder displays
    # paths relative to REPO_ROOT), so keep the test fixture there too.
    return tempfile.TemporaryDirectory(dir=REPO_ROOT)

# The builder lives under scripts/ (not an importable package), so load it by path.
_spec = importlib.util.spec_from_file_location(
    "build_benchmark_report", REPO_ROOT / "scripts" / "build_benchmark_report.py"
)
assert _spec and _spec.loader
build_benchmark_report = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build_benchmark_report)
bbr = build_benchmark_report


def _raw_report(architecture: str) -> dict:
    return {
        "architecture": architecture,
        "case_count": 3,
        "metrics": {
            "accuracy_rate": 1.0,
            "accuracy_passed": 3,
            "accuracy_total": 3,
            "strict_hallucination_count": 0,
            "strict_hallucination_rate": 0.0,
            "invalidation_rate": 1.0,
            "invalidation_passed": 2,
            "invalidation_total": 2,
        },
    }


def _comparable_baseline_report() -> tuple[dict, dict]:
    typed_report = bbr.run_benchmark()
    baseline_report = copy.deepcopy(typed_report)
    baseline_report["architecture"] = "single_agent_llm_baseline"
    baseline_report["evaluator_version"] = "single-agent-validation-test"
    return typed_report, baseline_report


class NormalizeTest(unittest.TestCase):
    def test_projects_metrics_into_fe_shape(self) -> None:
        out = bbr._normalize(_raw_report("single_agent_llm_baseline"))
        self.assertEqual(out["status"], "measured")
        self.assertEqual(out["caseCount"], 3)
        self.assertEqual(out["accuracyRate"], 1.0)
        self.assertEqual(out["accuracyPassed"], 3)
        self.assertEqual(out["hallucinationCount"], 0)
        self.assertEqual(out["invalidationRate"], 1.0)
        # Token cost is absent until instrumentation lands — surfaced as None, not faked.
        self.assertIsNone(out["tokenCostTotal"])


class LoadBaselineTest(unittest.TestCase):
    def _with_reports_dir(self, tmp: Path):
        return patch.object(bbr, "REPORTS_DIR", tmp)

    def test_missing_file_is_not_run(self) -> None:
        with _repo_temp_reports_dir() as d, self._with_reports_dir(Path(d)):
            self.assertIsNone(bbr._load_baseline("single_agent_llm_baseline"))

    def test_empty_file_is_not_run(self) -> None:
        with _repo_temp_reports_dir() as d, self._with_reports_dir(Path(d)):
            (Path(d) / "single_agent_llm_baseline.json").write_text("", encoding="utf-8")
            self.assertIsNone(bbr._load_baseline("single_agent_llm_baseline"))

    def test_invalid_json_is_not_run(self) -> None:
        import io
        from contextlib import redirect_stdout

        with _repo_temp_reports_dir() as d, self._with_reports_dir(Path(d)):
            (Path(d) / "single_agent_llm_baseline.json").write_text("{not json", encoding="utf-8")
            out = io.StringIO()
            with redirect_stdout(out):
                result = bbr._load_baseline("single_agent_llm_baseline")
            self.assertIsNone(result)
            self.assertIn("not valid JSON", out.getvalue())

    def test_architecture_mismatch_raises(self) -> None:
        import json as _json

        with _repo_temp_reports_dir() as d, self._with_reports_dir(Path(d)):
            (Path(d) / "single_agent_llm_baseline.json").write_text(
                _json.dumps(_raw_report("wrong_arch")), encoding="utf-8"
            )
            with self.assertRaises(ValueError):
                bbr._load_baseline("single_agent_llm_baseline")

    def test_valid_matching_report_is_returned(self) -> None:
        import json as _json

        with _repo_temp_reports_dir() as d, self._with_reports_dir(Path(d)):
            report = _raw_report("single_agent_llm_baseline")
            (Path(d) / "single_agent_llm_baseline.json").write_text(
                _json.dumps(report), encoding="utf-8"
            )
            self.assertEqual(bbr._load_baseline("single_agent_llm_baseline"), report)


class BuildTest(unittest.TestCase):
    def assertBaselineValidationError(
        self,
        mutate,
        expected_message: str,
    ) -> None:
        typed_report, baseline_report = _comparable_baseline_report()
        mutate(baseline_report)

        with self.assertRaisesRegex(ValueError, expected_message):
            bbr._validate_baseline_report(baseline_report, typed_report)

    def test_typed_graph_measured_baselines_not_run_when_absent(self) -> None:
        with _repo_temp_reports_dir() as d, patch.object(bbr, "REPORTS_DIR", Path(d)):
            report = bbr.build()

        by_key = {a["key"]: a for a in report["architectures"]}
        self.assertEqual(by_key["typed_graph_fixture"]["status"], "measured")
        for baseline in ("free_text_multiagent_baseline", "single_agent_llm_baseline"):
            self.assertEqual(by_key[baseline]["status"], "not_run")
            # not_run entries carry the exact command to produce them (never faked).
            self.assertIn("run", by_key[baseline])
        self.assertIn("generatedAt", report)
        self.assertIn("benchmarkId", report)

    def test_comparable_baseline_report_can_be_measured(self) -> None:
        _, baseline_report = _comparable_baseline_report()

        with _repo_temp_reports_dir() as d, patch.object(bbr, "REPORTS_DIR", Path(d)):
            path = Path(d) / "single_agent_llm_baseline.json"
            path.write_text(json.dumps(baseline_report), encoding="utf-8")

            report = bbr.build()

        by_key = {a["key"]: a for a in report["architectures"]}
        self.assertEqual(by_key["single_agent_llm_baseline"]["status"], "measured")
        self.assertEqual(by_key["single_agent_llm_baseline"]["caseCount"], 30)

    def test_mismatched_baseline_benchmark_id_is_rejected(self) -> None:
        self.assertBaselineValidationError(
            lambda report: report.update({"benchmark_id": "other-benchmark"}),
            "benchmark_id",
        )

    def test_mismatched_baseline_fixture_id_is_rejected(self) -> None:
        self.assertBaselineValidationError(
            lambda report: report.update({"fixture_id": "other-fixture"}),
            "fixture_id",
        )

    def test_mismatched_baseline_metric_definitions_are_rejected(self) -> None:
        self.assertBaselineValidationError(
            lambda report: report.update({"metric_definitions": {"version": "other"}}),
            "metric definitions",
        )

    def test_missing_baseline_cases_are_rejected(self) -> None:
        self.assertBaselineValidationError(
            lambda report: report.pop("cases"),
            "must include cases",
        )

    def test_partial_baseline_report_is_rejected_before_it_can_be_measured(self) -> None:
        self.assertBaselineValidationError(
            lambda report: report.update({"cases": report["cases"][:1]}),
            "full ordered case list",
        )

    def test_baseline_case_count_mismatch_is_rejected(self) -> None:
        self.assertBaselineValidationError(
            lambda report: report.update({"case_count": 1}),
            "case_count must be 30",
        )

    def test_baseline_accuracy_total_mismatch_is_rejected(self) -> None:
        self.assertBaselineValidationError(
            lambda report: report["metrics"].update({"accuracy_total": 1}),
            "accuracy_total must be 30",
        )

    def test_missing_baseline_hallucination_case_ids_are_rejected(self) -> None:
        self.assertBaselineValidationError(
            lambda report: report["metrics"].pop("strict_hallucination_case_ids"),
            "strict_hallucination_case_ids",
        )

    def test_baseline_hallucination_case_count_mismatch_is_rejected(self) -> None:
        self.assertBaselineValidationError(
            lambda report: report["metrics"].update(
                {"strict_hallucination_case_count": 1}
            ),
            "strict_hallucination_case_count must match",
        )

    def test_baseline_report_with_unknown_hallucination_case_id_is_rejected(
        self,
    ) -> None:
        def add_unknown_hallucination_id(report: dict) -> None:
            report["metrics"]["strict_hallucination_case_count"] = 1
            report["metrics"]["strict_hallucination_case_ids"] = [
                "not_a_benchmark_case"
            ]

        self.assertBaselineValidationError(
            add_unknown_hallucination_id,
            "outside the benchmark corpus",
        )

    def test_baseline_invalidation_total_mismatch_is_rejected(self) -> None:
        self.assertBaselineValidationError(
            lambda report: report["metrics"].update({"invalidation_total": 1}),
            "invalidation_total must be 5",
        )


if __name__ == "__main__":
    unittest.main()
