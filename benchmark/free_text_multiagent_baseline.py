"""CrewAI-style free-text multi-agent baseline for the seeded benchmark.

This runner is intentionally deterministic for the first RCG-36 slice. It uses
the same fixture facts and gold cases as the typed path, but represents
coordination as role-tagged free-text messages plus JSON tool payloads. The
baseline output is shaped like a final persisted plan only; it does not expose
typed graph dependency edges or coordination records.
"""

from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

from agents.redemption.planner import (
    apply_balance_delta,
    load_fixture,
    plan_redemption,
)
from benchmark.person_c_scorer import (
    balance_by_slug,
    metric_rate,
    score_plan_against_case,
)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURE_PATH = ROOT / "fixtures" / "person-c-mvp-seed.json"
DEFAULT_CASES_PATH = ROOT / "benchmark" / "gold" / "person-c-mvp-cases.json"
BALANCE_SLUG = "balance:user_mvp_demo:chase_ur"
EVALUATOR_VERSION = "free-text-multiagent-baseline-v1"


def run_free_text_multiagent_baseline(
    fixture_path: str | Path = DEFAULT_FIXTURE_PATH,
    cases_path: str | Path = DEFAULT_CASES_PATH,
) -> dict[str, Any]:
    fixture = load_fixture(fixture_path)
    benchmark = load_fixture(cases_path)
    case_results = [_score_case(fixture, case) for case in benchmark["cases"]]
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

    return {
        "benchmark_id": benchmark["benchmark_id"],
        "fixture_id": fixture["fixture_id"],
        "architecture": "free_text_multiagent_baseline",
        "plan_type": "baseline_free_text_multiagent",
        "evaluator_version": EVALUATOR_VERSION,
        "case_count": len(case_results),
        "metrics": {
            "accuracy_passed": sum(1 for result in case_results if result["accuracy_correct"]),
            "accuracy_total": len(case_results),
            "accuracy_rate": metric_rate(
                sum(1 for result in case_results if result["accuracy_correct"]),
                len(case_results),
            ),
            "strict_hallucination_count": sum(
                result["hallucination_count"]
                for result in case_results
            ),
            "strict_hallucination_rate": metric_rate(
                len(hallucination_cases),
                len(case_results),
            ),
            "invalidation_passed": sum(
                1
                for result in invalidation_results
                if result["invalidation_correct"]
            ),
            "invalidation_total": len(invalidation_results),
            "invalidation_rate": metric_rate(
                sum(
                    1
                    for result in invalidation_results
                    if result["invalidation_correct"]
                ),
                len(invalidation_results),
            ),
            "token_cost_total": sum(
                result["token_cost_estimate"]
                for result in case_results
            ),
        },
        "cases": case_results,
    }


def report_completed(report: dict[str, Any]) -> bool:
    return (
        report["architecture"] == "free_text_multiagent_baseline"
        and report["case_count"] == len(report["cases"])
        and all(case["run_status"] == "completed" for case in report["cases"])
    )


def _score_case(base_fixture: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    fixture = copy.deepcopy(base_fixture)

    if "mutation" in case:
        balance_by_slug(fixture, BALANCE_SLUG)["balance_points"] = case["starting_balance_points"]
        fixture = apply_balance_delta(
            fixture,
            BALANCE_SLUG,
            case["mutation"]["delta_points"],
        )
        plan = plan_redemption(
            fixture,
            query_text=case["query"],
            overrides=case.get("overrides"),
        )
        invalidation_correct = False
    else:
        plan = plan_redemption(
            fixture,
            balance_points=case.get("starting_balance_points"),
            query_text=case["query"],
            overrides=case.get("overrides"),
        )
        invalidation_correct = None

    raw_output = _free_text_raw_output(fixture, case, plan)
    scored = score_plan_against_case(fixture, plan, case)

    return {
        "case_id": case["case_id"],
        "category": case["category"],
        "run_status": "completed",
        "accuracy_correct": scored["accuracy_correct"],
        "hallucination_count": scored["hallucination_count"],
        "hallucination_issues": scored["hallucination_issues"],
        "invalidation_correct": invalidation_correct,
        "stale_step_orders": [],
        "expected_top_award_slug": case.get("expected_top_award_slug"),
        "actual_top_award_slug": plan["chosen_award_slug"],
        "expected_fallback": case.get("expected_fallback"),
        "actual_fallback": plan.get("fallback"),
        "status": plan["status"],
        "token_cost_estimate": _token_cost_estimate(raw_output),
        "raw_output": raw_output,
    }


def _free_text_raw_output(
    fixture: dict[str, Any],
    case: dict[str, Any],
    plan: dict[str, Any],
) -> dict[str, Any]:
    tool_fixture = _fixture_with_case_overrides(fixture, case)
    return {
        "architecture": "free_text_multiagent_baseline",
        "plan_type": "baseline_free_text_multiagent",
        "coordination_mode": "free_text_messages",
        "tool_output_mode": "json",
        "persistence_shape": ["plans", "evaluations"],
        "final_plan_only": True,
        "crew": [
            "coordinator",
            "wallet_agent",
            "redemption_agent",
            "critic_agent",
        ],
        "transcript": _transcript(case, plan),
        "tool_outputs": _json_tool_outputs(tool_fixture, case),
        "final_plan": _final_plan(plan),
    }


def _transcript(case: dict[str, Any], plan: dict[str, Any]) -> list[dict[str, str]]:
    chosen = plan["chosen_award_slug"] or plan.get("fallback") or plan["status"]
    return [
        {
            "agent": "coordinator",
            "message": f"Route the user query to wallet and redemption specialists: {case['query']}",
        },
        {
            "agent": "wallet_agent",
            "message": "Use the provided JSON wallet balance. Do not infer unseeded balances.",
        },
        {
            "agent": "redemption_agent",
            "message": f"Rank only seeded award JSON records; selected outcome: {chosen}.",
        },
        {
            "agent": "critic_agent",
            "message": "Check affordability, availability, transfer ratio, and unsupported-program traps.",
        },
    ]


def _json_tool_outputs(fixture: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    balance = balance_by_slug(fixture, BALANCE_SLUG)
    scoped_awards = [
        {
            "award_slug": award["slug"],
            "hotel_slug": award["hotel_slug"],
            "program_slug": award["program_slug"],
            "city": award["city"],
            "nights": award["nights"],
            "available": award["available"],
            "points_total": award["points_total"],
            "cash_total_cents": award["cash_total_cents"],
            "value_basis_points": award["value_basis_points"],
        }
        for award in fixture["award_options"]
        if award["program_slug"] == fixture["scope"]["target_program_slug"]
        and award["city"] == fixture["scope"]["destination_city"]
        and award["nights"] == fixture["scope"]["nights"]
    ]
    return {
        "wallet_balance": {
            "program_slug": balance["program_slug"],
            "balance_points": balance["balance_points"],
        },
        "transfer_route": {
            "source_program_slug": fixture["scope"]["source_program_slug"],
            "dest_program_slug": fixture["scope"]["target_program_slug"],
            "transfer_ratio_basis_points": fixture["transfer_paths"][0]["transfer_ratio_basis_points"],
            "transfer_time_days": fixture["transfer_paths"][0]["transfer_time_days"],
        },
        "award_search": {
            "city": fixture["scope"]["destination_city"],
            "nights": fixture["scope"]["nights"],
            "awards": scoped_awards,
        },
        "case_overrides": case.get("overrides", {}),
    }


def _fixture_with_case_overrides(
    fixture: dict[str, Any],
    case: dict[str, Any],
) -> dict[str, Any]:
    overrides = case.get("overrides", {})
    if not overrides:
        return fixture

    copied = copy.deepcopy(fixture)
    award_by_slug = {award["slug"]: award for award in copied["award_options"]}
    for award_slug, changes in overrides.items():
        if award_slug in award_by_slug:
            award_by_slug[award_slug].update(changes)
    return copied


def _final_plan(plan: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": plan["status"],
        "query_text": plan["query_text"],
        "chosen_award_slug": plan["chosen_award_slug"],
        "backup_award_slug": plan["backup_award_slug"],
        "fallback": plan.get("fallback"),
        "unsupported_reason": plan.get("unsupported_reason"),
        "ranked_awards": [
            {
                "award_slug": award["award_slug"],
                "hotel_slug": award["hotel_slug"],
                "hotel_name": award["hotel_name"],
                "points_total": award["points_total"],
                "required_source_points": award["required_source_points"],
                "cash_total_cents": award["cash_total_cents"],
                "value_basis_points": award["value_basis_points"],
            }
            for award in plan.get("ranked_awards", [])
        ],
        "steps": [
            {
                "step_order": step["step_order"],
                "step_type": step["step_type"],
                "action": step["action"],
                "reasoning": step["reasoning"],
                "payload": _sanitize_payload(step.get("payload", {})),
            }
            for step in plan["steps"]
        ],
    }


def _sanitize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    sanitized = copy.deepcopy(payload)
    sanitized.pop("candidate_fact_slugs", None)
    return sanitized


def _token_cost_estimate(raw_output: dict[str, Any]) -> int:
    serialized = json.dumps(raw_output, sort_keys=True)
    return max(1, (len(serialized) + 3) // 4)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the free-text multi-agent baseline.")
    parser.add_argument("--fixture", default=str(DEFAULT_FIXTURE_PATH))
    parser.add_argument("--cases", default=str(DEFAULT_CASES_PATH))
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    report = run_free_text_multiagent_baseline(args.fixture, args.cases)
    indent = 2 if args.pretty else None
    print(json.dumps(report, indent=indent, sort_keys=True))
    return 0 if report_completed(report) else 1


if __name__ == "__main__":
    raise SystemExit(main())
