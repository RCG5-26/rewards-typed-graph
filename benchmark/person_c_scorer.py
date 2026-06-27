"""Offline scorer for the Person C seeded redemption benchmark."""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

from agents.redemption.planner import (
    apply_balance_delta,
    find_stale_steps_for_balance,
    load_fixture,
    plan_redemption,
)
from benchmark.metric_summary import (
    build_metric_definitions,
    count_case_values,
    rate as score_rate,
    summarize_case_metrics,
)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURE_PATH = ROOT / "fixtures" / "person-c-mvp-seed.json"
DEFAULT_CASES_PATH = ROOT / "benchmark" / "gold" / "person-c-mvp-cases.json"
BALANCE_SLUG = "balance:user_mvp_demo:chase_ur"
EVALUATOR_VERSION = "person-c-offline-scorer-v1"


def run_benchmark(
    fixture_path: str | Path = DEFAULT_FIXTURE_PATH,
    cases_path: str | Path = DEFAULT_CASES_PATH,
    limit: int | None = None,
) -> dict[str, Any]:
    fixture = load_fixture(fixture_path)
    benchmark = load_fixture(cases_path)
    cases = benchmark["cases"][:limit] if limit is not None else benchmark["cases"]
    case_results = [_score_case(fixture, case) for case in cases]

    return {
        "benchmark_id": benchmark["benchmark_id"],
        "fixture_id": fixture["fixture_id"],
        "architecture": "typed_graph_fixture",
        "evaluator_version": EVALUATOR_VERSION,
        "case_count": len(case_results),
        "metric_definitions": build_metric_definitions(benchmark),
        "benchmark_axis_counts": count_case_values(case_results, "benchmark_axis"),
        "category_counts": count_case_values(case_results, "category"),
        "metrics": summarize_case_metrics(case_results),
        "cases": case_results,
    }


def report_passed(report: dict[str, Any]) -> bool:
    metrics = report["metrics"]
    return (
        metrics["accuracy_passed"] == metrics["accuracy_total"]
        and metrics["strict_hallucination_count"] == 0
        and metrics["invalidation_passed"] == metrics["invalidation_total"]
    )


def _score_case(base_fixture: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    fixture = copy.deepcopy(base_fixture)
    stale_steps: list[dict[str, Any]] = []
    invalidation_correct: bool | None = None

    if "mutation" in case:
        _balance_by_slug(fixture, BALANCE_SLUG)["balance_points"] = case["starting_balance_points"]
        pre_mutation_plan = plan_redemption(
            fixture,
            query_text=case["query"],
            overrides=case.get("overrides"),
        )
        fixture = apply_balance_delta(
            fixture,
            BALANCE_SLUG,
            case["mutation"]["delta_points"],
        )
        current_balance = _balance_by_slug(fixture, BALANCE_SLUG)
        stale_steps = find_stale_steps_for_balance(pre_mutation_plan, current_balance)
        invalidation_correct = (
            bool(stale_steps)
            and current_balance["balance_points"] == case["mutation"]["new_balance_points"]
            and pre_mutation_plan["chosen_award_slug"] == case.get("stale_award_slug")
        )
        plan = plan_redemption(
            fixture,
            query_text=case["query"],
            overrides=case.get("overrides"),
        )
    else:
        plan = plan_redemption(
            fixture,
            balance_points=case.get("starting_balance_points"),
            query_text=case["query"],
            overrides=case.get("overrides"),
        )

    accuracy_correct = _accuracy_correct(plan, case)
    hallucination_issues = _hallucination_issues(fixture, plan, case)
    if invalidation_correct is not None:
        invalidation_correct = invalidation_correct and accuracy_correct

    return {
        "case_id": case["case_id"],
        "benchmark_axis": case["benchmark_axis"],
        "category": case["category"],
        "invalidation_kind": invalidation_kind_for_case(case),
        "accuracy_correct": accuracy_correct,
        "hallucination_count": len(hallucination_issues),
        "hallucination_issues": hallucination_issues,
        "invalidation_correct": invalidation_correct,
        "stale_step_orders": [step["step_order"] for step in stale_steps],
        "expected_top_award_slug": case.get("expected_top_award_slug"),
        "actual_top_award_slug": plan["chosen_award_slug"],
        "expected_fallback": case.get("expected_fallback"),
        "actual_fallback": plan.get("fallback"),
        "status": plan["status"],
    }


def invalidation_kind_for_case(case: dict[str, Any]) -> str | None:
    """Return a case's invalidation_kind, requiring it on mutation cases.

    A mutation case without an explicit kind would otherwise be silently grouped
    as "unspecified" in the per-kind benchmark totals (metric_summary.py), which
    skews the comparison. Fail fast instead so the gold corpus stays well-formed.
    """
    if "mutation" in case:
        kind = case.get("invalidation_kind")
        if not kind:
            raise ValueError(
                f"mutation case {case.get('case_id')!r} must set invalidation_kind"
            )
        return kind
    return case.get("invalidation_kind")


def _balance_by_slug(fixture: dict[str, Any], balance_slug: str) -> dict[str, Any]:
    for balance in fixture["balances"]:
        if balance["slug"] == balance_slug:
            return balance
    raise ValueError(f"unknown balance slug: {balance_slug}")


def _accuracy_correct(plan: dict[str, Any], case: dict[str, Any]) -> bool:
    if "expected_response" in case:
        return (
            plan["status"] == "unsupported"
            and plan.get("unsupported_reason") == case["expected_response"]
        )

    if case.get("expected_top_award_slug") is not None:
        accepted = set(case.get("accepted_award_slugs") or [case["expected_top_award_slug"]])
        return plan["chosen_award_slug"] in accepted

    if case.get("expected_fallback") is not None:
        return plan.get("fallback") == case["expected_fallback"]

    return plan["chosen_award_slug"] is None


def _hallucination_issues(
    fixture: dict[str, Any],
    plan: dict[str, Any],
    case: dict[str, Any],
) -> list[str]:
    issues: list[str] = []
    award_by_slug = {award["slug"]: award for award in fixture["award_options"]}
    valid_fact_slugs = _fixture_fact_slugs(fixture)
    balance_points = _case_current_balance(case)

    chosen_award = plan["chosen_award_slug"]
    if chosen_award is not None and chosen_award not in award_by_slug:
        issues.append("award_not_in_tool_result")

    for candidate in plan.get("ranked_awards", []):
        award_slug = candidate["award_slug"]
        if award_slug not in award_by_slug:
            issues.append("award_not_in_tool_result")
            continue
        if candidate["required_source_points"] > balance_points:
            issues.append("incorrect_point_balance")
        if not award_by_slug[award_slug]["available"] and not _case_marks_unavailable(case, award_slug):
            issues.append("award_not_in_tool_result")
        for fact_slug in candidate["candidate_fact_slugs"]:
            if fact_slug not in valid_fact_slugs:
                issues.append("award_not_in_tool_result")

    for step in plan["steps"]:
        for dependency in step["state_dependencies"]:
            if dependency["snapshot_value"]["balance_points"] != plan["balance_points"]:
                issues.append("incorrect_point_balance")
        payload = step.get("payload", {})
        ratio = payload.get("transfer_ratio_basis_points")
        if ratio is not None and ratio != 10_000:
            issues.append("wrong_transfer_ratio")

    return sorted(set(issues))


def _case_current_balance(case: dict[str, Any]) -> int:
    if "mutation" in case:
        return case["mutation"]["new_balance_points"]
    return case["starting_balance_points"]


def _case_marks_unavailable(case: dict[str, Any], award_slug: str) -> bool:
    return case.get("overrides", {}).get(award_slug, {}).get("available") is False


def _fixture_fact_slugs(fixture: dict[str, Any]) -> set[str]:
    slugs = set()
    for collection_name in ("transfer_paths", "award_options", "hotels"):
        slugs.update(item["slug"] for item in fixture[collection_name])
    slugs.update(award["cash_quote_slug"] for award in fixture["award_options"])
    return slugs


# Public scoring API. Alternative architectures (e.g. the single-agent LLM
# baseline) reuse these so every architecture is graded by identical logic.
# Exposed as stable names so callers don't import underscore-private helpers.
accuracy_correct = _accuracy_correct
hallucination_issues = _hallucination_issues
case_current_balance = _case_current_balance
rate = score_rate


def main() -> int:
    parser = argparse.ArgumentParser(description="Score the Person C seeded benchmark.")
    parser.add_argument("--fixture", default=str(DEFAULT_FIXTURE_PATH))
    parser.add_argument("--cases", default=str(DEFAULT_CASES_PATH))
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    report = run_benchmark(args.fixture, args.cases, limit=args.limit)
    indent = 2 if args.pretty else None
    print(json.dumps(report, indent=indent, sort_keys=True))
    return 0 if report_passed(report) else 1


if __name__ == "__main__":
    raise SystemExit(main())
