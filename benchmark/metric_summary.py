"""Shared Person C benchmark metric definitions and aggregation."""

from __future__ import annotations

from collections import Counter
from typing import Any


METRIC_DEFINITION_VERSION = "person-c-metrics-v1"


def build_metric_definitions(benchmark: dict[str, Any]) -> dict[str, Any]:
    """Return the frozen metric definitions attached to every report."""
    scoring_rules = benchmark.get("scoring_rules", {})
    return {
        "metric_definition_version": METRIC_DEFINITION_VERSION,
        "fixture_id": benchmark.get("fixture_id"),
        "gold_as_of": benchmark.get("as_of"),
        "strict_hallucination_rate": {
            "ticket": "RCG-34",
            "numerator": "cases_with_one_or_more_strict_hallucination_issues",
            "denominator": "all_benchmark_cases",
            "issue_types": list(scoring_rules.get("strict_hallucinations", [])),
            "case_level_traps": "per-case disqualifying_hallucinations in the gold corpus",
            "program_existence_issue_types": [
                "nonexistent_transfer_partner",
                "unsupported_hotel_or_program_rule",
                "award_not_in_tool_result",
            ],
            "ratio_or_point_math_issue_types": [
                "wrong_transfer_ratio",
                "incorrect_point_balance",
            ],
        },
        "plan_invalidation_correctness": {
            "ticket": "RCG-38",
            "eligible_case_selector": "benchmark cases with a mutation object",
            "kind_field": "invalidation_kind",
            "pass_criteria": [
                "the pre-mutation plan has stale dependent steps",
                "the triggering balance mutation reaches the gold new balance",
                "the pre-mutation chosen award matches stale_award_slug",
                "the post-mutation recommendation or fallback matches the gold answer",
            ],
            "baseline_credit_rule": (
                "typed-graph architectures must prove structural invalidation; "
                "output-sink baselines score false for every mutation case"
            ),
        },
    }


def count_case_values(case_results: list[dict[str, Any]], key: str) -> dict[str, int]:
    """Count non-empty case result values for a stable report section."""
    return dict(
        sorted(
            Counter(
                str(result[key])
                for result in case_results
                if result.get(key) is not None
            ).items()
        )
    )


def summarize_case_metrics(
    case_results: list[dict[str, Any]],
    *,
    token_cost_total: int | None = None,
) -> dict[str, Any]:
    """Build the shared metric payload used by typed and baseline reports."""
    invalidation_results = [
        result
        for result in case_results
        if result["invalidation_correct"] is not None
    ]
    hallucination_cases = [
        result
        for result in case_results
        if result["hallucination_count"] > 0
    ]
    accuracy_passed = sum(1 for result in case_results if result["accuracy_correct"])
    invalidation_passed = sum(
        1 for result in invalidation_results if result["invalidation_correct"]
    )
    metrics: dict[str, Any] = {
        "accuracy_passed": accuracy_passed,
        "accuracy_total": len(case_results),
        "accuracy_rate": rate(accuracy_passed, len(case_results)),
        "strict_hallucination_count": sum(
            result["hallucination_count"] for result in case_results
        ),
        "strict_hallucination_case_count": len(hallucination_cases),
        "strict_hallucination_case_ids": [
            result["case_id"] for result in hallucination_cases
        ],
        "strict_hallucination_issue_counts": _hallucination_issue_counts(case_results),
        "strict_hallucination_rate": rate(
            len(hallucination_cases),
            len(case_results),
        ),
        "invalidation_passed": invalidation_passed,
        "invalidation_total": len(invalidation_results),
        "invalidation_case_ids": [
            result["case_id"] for result in invalidation_results
        ],
        "invalidation_rate": rate(
            invalidation_passed,
            len(invalidation_results),
        ),
        "invalidation_wins_by_kind": _invalidation_wins_by_kind(
            invalidation_results
        ),
    }
    if token_cost_total is not None:
        metrics["token_cost_total"] = token_cost_total
    return metrics


def rate(numerator: int, denominator: int) -> float | None:
    """Return a report rate, leaving empty denominators as null in JSON."""
    if denominator == 0:
        return None
    return numerator / denominator


def _hallucination_issue_counts(
    case_results: list[dict[str, Any]],
) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for result in case_results:
        counts.update(result["hallucination_issues"])
    return dict(sorted(counts.items()))


def _invalidation_wins_by_kind(
    invalidation_results: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    by_kind: dict[str, list[dict[str, Any]]] = {}
    for result in invalidation_results:
        kind = result.get("invalidation_kind") or "unspecified"
        by_kind.setdefault(kind, []).append(result)

    return {
        kind: {
            "passed": sum(1 for result in results if result["invalidation_correct"]),
            "total": len(results),
            "rate": rate(
                sum(1 for result in results if result["invalidation_correct"]),
                len(results),
            ),
            "case_ids": [result["case_id"] for result in results],
        }
        for kind, results in sorted(by_kind.items())
    }
