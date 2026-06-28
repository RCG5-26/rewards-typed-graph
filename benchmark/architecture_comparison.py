"""Cross-architecture benchmark report builder for RCG-37."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


REQUIRED_ARCHITECTURES = (
    "typed_graph_fixture",
    "single_agent_llm_baseline",
    "free_text_multiagent_baseline",
)
EVALUATOR_VERSION = "architecture-comparison-v1"


def build_architecture_comparison(reports: list[dict[str, Any]]) -> dict[str, Any]:
    """Combine three architecture reports into the RCG-37 comparison shape."""
    reports_by_architecture = _reports_by_architecture(reports)
    benchmark_id = _shared_field(reports, "benchmark_id")
    fixture_id = _shared_field(reports, "fixture_id")
    for report in reports:
        _validate_unique_case_ids(report)
    case_ids = _case_ids(reports[0])
    for report in reports[1:]:
        if _case_ids(report) != case_ids:
            raise ValueError("architecture reports must use identical ordered case ids")

    return {
        "benchmark_id": benchmark_id,
        "fixture_id": fixture_id,
        "evaluator_version": EVALUATOR_VERSION,
        "required_architectures": list(REQUIRED_ARCHITECTURES),
        "architecture_count": len(reports_by_architecture),
        "case_count": len(case_ids),
        "architectures": {
            architecture: _architecture_summary(reports_by_architecture[architecture])
            for architecture in REQUIRED_ARCHITECTURES
        },
        "case_matrix": [
            _case_matrix_row(case_id, reports_by_architecture)
            for case_id in case_ids
        ],
    }


def _reports_by_architecture(
    reports: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    reports_by_architecture: dict[str, dict[str, Any]] = {}
    for report in reports:
        architecture = report.get("architecture")
        if architecture in reports_by_architecture:
            raise ValueError(f"duplicate architecture report: {architecture}")
        reports_by_architecture[str(architecture)] = report

    missing = [
        architecture
        for architecture in REQUIRED_ARCHITECTURES
        if architecture not in reports_by_architecture
    ]
    if missing:
        raise ValueError(f"missing architecture reports: {missing}")

    extra = [
        architecture
        for architecture in reports_by_architecture
        if architecture not in REQUIRED_ARCHITECTURES
    ]
    if extra:
        raise ValueError(f"unexpected architecture reports: {extra}")

    return reports_by_architecture


def _shared_field(reports: list[dict[str, Any]], field_name: str) -> Any:
    values = {report.get(field_name) for report in reports}
    if len(values) != 1:
        raise ValueError(f"architecture reports must share {field_name}")
    return values.pop()


def _case_ids(report: dict[str, Any]) -> list[str]:
    return [case["case_id"] for case in report["cases"]]


def _validate_unique_case_ids(report: dict[str, Any]) -> None:
    seen: set[str] = set()
    duplicates: list[str] = []
    for case_id in _case_ids(report):
        if case_id in seen:
            duplicates.append(case_id)
        seen.add(case_id)
    if duplicates:
        architecture = report.get("architecture")
        raise ValueError(
            f"duplicate case_id values in {architecture} report: {sorted(set(duplicates))}"
        )


def _architecture_summary(report: dict[str, Any]) -> dict[str, Any]:
    metrics = report["metrics"]
    return {
        "evaluator_version": report["evaluator_version"],
        "case_count": report["case_count"],
        "accuracy_passed": metrics["accuracy_passed"],
        "accuracy_total": metrics["accuracy_total"],
        "accuracy_rate": metrics["accuracy_rate"],
        "strict_hallucination_count": metrics["strict_hallucination_count"],
        "strict_hallucination_rate": metrics["strict_hallucination_rate"],
        "invalidation_passed": metrics["invalidation_passed"],
        "invalidation_total": metrics["invalidation_total"],
        "invalidation_rate": metrics["invalidation_rate"],
        "token_cost_total": metrics.get("token_cost_total"),
    }


def _case_matrix_row(
    case_id: str,
    reports_by_architecture: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    return {
        "case_id": case_id,
        "architectures": {
            architecture: _case_summary(_case_by_id(report, case_id))
            for architecture, report in (
                (architecture, reports_by_architecture[architecture])
                for architecture in REQUIRED_ARCHITECTURES
            )
        },
    }


def _case_by_id(report: dict[str, Any], case_id: str) -> dict[str, Any]:
    for case in report["cases"]:
        if case["case_id"] == case_id:
            return case
    raise ValueError(f"case ids are inconsistent; missing {case_id}")


def _case_summary(case: dict[str, Any]) -> dict[str, Any]:
    return {
        "accuracy_correct": case["accuracy_correct"],
        "hallucination_count": case["hallucination_count"],
        "invalidation_correct": case["invalidation_correct"],
    }


def _load_report(path: str | Path) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build an RCG-37 comparison from three architecture report JSON files."
    )
    parser.add_argument("--typed-report", required=True)
    parser.add_argument("--single-agent-report", required=True)
    parser.add_argument("--free-text-report", required=True)
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    comparison = build_architecture_comparison(
        [
            _load_report(args.typed_report),
            _load_report(args.single_agent_report),
            _load_report(args.free_text_report),
        ]
    )
    indent = 2 if args.pretty else None
    print(json.dumps(comparison, indent=indent, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
