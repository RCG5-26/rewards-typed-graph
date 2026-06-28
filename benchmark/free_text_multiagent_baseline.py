"""Free-text multi-agent baseline for the Person C benchmark.

This is Architecture 2 from ADR 0002/0003: a CrewAI-style baseline where role
agents hand off prose/JSON notes to each other, but the final artifact is still
only a baseline output sink. It does not emit typed graph mutations,
plan_steps, or state_dependencies.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import sys
from pathlib import Path
from typing import Any

from agents.redemption.planner import apply_balance_delta, load_fixture
from benchmark.metric_summary import (
    build_metric_definitions,
    count_case_values,
    summarize_case_metrics,
)
from benchmark.person_c_scorer import (
    accuracy_correct as score_accuracy_correct,
    case_current_balance as score_case_current_balance,
    hallucination_issues as score_hallucination_issues,
    invalidation_kind_for_case,
)
from benchmark.single_agent_baseline import (
    BaselineConfigError,
    BaselineOutputError,
    FORBIDDEN_BASELINE_OUTPUT_KEYS,
    LLMClient,
    LLMResponse,
    OpenAIChatCompletionsClient as _BaseOpenAIChatCompletionsClient,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURE_PATH = ROOT / "fixtures" / "person-c-mvp-seed.json"
DEFAULT_CASES_PATH = ROOT / "benchmark" / "gold" / "person-c-mvp-cases.json"
BALANCE_SLUG = "balance:user_mvp_demo:chase_ur"
EVALUATOR_VERSION = "free-text-multiagent-baseline-v1"

DEFAULT_API_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = "gpt-5.5"
API_KEY_ENV = "FREE_TEXT_MULTIAGENT_BASELINE_API_KEY"
FALLBACK_API_KEY_ENV = "OPENAI_API_KEY"
FREE_TEXT_AGENT_ROLES = (
    "wallet_agent",
    "earning_agent",
    "redemption_agent",
    "coordinator",
)


class OpenAIChatCompletionsClient(_BaseOpenAIChatCompletionsClient):
    """OpenAI-compatible JSON client configured with RCG-36 env names."""

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "OpenAIChatCompletionsClient":
        source = env or os.environ
        api_key = source.get(API_KEY_ENV) or source.get(FALLBACK_API_KEY_ENV)
        if api_key is None or not api_key.strip():
            raise BaselineConfigError(
                f"set {API_KEY_ENV} (or {FALLBACK_API_KEY_ENV}) to run the live free-text baseline"
            )
        timeout_raw = source.get("FREE_TEXT_MULTIAGENT_BASELINE_TIMEOUT_SECONDS", "60")
        try:
            timeout_seconds = int(timeout_raw)
        except ValueError as error:
            raise BaselineConfigError(
                f"FREE_TEXT_MULTIAGENT_BASELINE_TIMEOUT_SECONDS must be an integer, got {timeout_raw!r}"
            ) from error
        if timeout_seconds <= 0:
            raise BaselineConfigError(
                "FREE_TEXT_MULTIAGENT_BASELINE_TIMEOUT_SECONDS must be positive"
            )
        return cls(
            api_key=api_key,
            model=source.get("FREE_TEXT_MULTIAGENT_BASELINE_MODEL", DEFAULT_MODEL),
            api_url=source.get("FREE_TEXT_MULTIAGENT_BASELINE_API_URL", DEFAULT_API_URL),
            timeout_seconds=timeout_seconds,
        )


def run_free_text_multiagent_baseline(
    *,
    llm_client: LLMClient,
    fixture_path: str | Path = DEFAULT_FIXTURE_PATH,
    cases_path: str | Path = DEFAULT_CASES_PATH,
    limit: int | None = None,
) -> dict[str, Any]:
    """Run the role-agent free-text baseline and return a scorer-shaped report."""

    fixture = load_fixture(fixture_path)
    benchmark = load_fixture(cases_path)
    cases = benchmark["cases"][:limit] if limit is not None else benchmark["cases"]
    # Progress to stderr (stdout stays the clean JSON report). The free-text
    # baseline makes several LLM calls per case, so it is the slowest run.
    case_results = []
    for index, case in enumerate(cases, start=1):
        print(f"[free-text] {index}/{len(cases)} {case['case_id']}", file=sys.stderr, flush=True)
        case_results.append(_run_case(llm_client, fixture, case))
    token_cost_total = sum(result["token_cost_total"] for result in case_results)

    return {
        "benchmark_id": benchmark["benchmark_id"],
        "fixture_id": fixture["fixture_id"],
        "architecture": "free_text_multiagent_baseline",
        "evaluator_version": EVALUATOR_VERSION,
        "case_count": len(case_results),
        "metric_definitions": build_metric_definitions(benchmark),
        "benchmark_axis_counts": count_case_values(case_results, "benchmark_axis"),
        "category_counts": count_case_values(case_results, "category"),
        "metrics": summarize_case_metrics(
            case_results,
            token_cost_total=token_cost_total,
        ),
        "cases": case_results,
    }


def _run_case(
    llm_client: LLMClient,
    base_fixture: dict[str, Any],
    case: dict[str, Any],
) -> dict[str, Any]:
    fixture = _fixture_for_case(base_fixture, case)
    transcript: list[dict[str, Any]] = []
    token_cost_total = 0
    final_raw_output: dict[str, Any] | None = None

    for role in FREE_TEXT_AGENT_ROLES:
        response = llm_client.complete_json(
            system_prompt=_system_prompt(role),
            user_prompt=_user_prompt(fixture, case, role, transcript),
        )
        token_cost_total += response.total_tokens
        raw_output = _parse_raw_output(response.content)
        _reject_forbidden_output(raw_output)

        if role == "coordinator":
            final_raw_output = raw_output
            transcript.append(
                {
                    "role": role,
                    "agent_notes": "Coordinator produced the final baseline plan.",
                    "tool_observations": [],
                }
            )
        else:
            transcript.append(_normalize_agent_handoff(role, raw_output))

    if final_raw_output is None:
        raise BaselineOutputError("free-text baseline did not produce a final plan")

    plan = _normalize_plan(final_raw_output)
    scoring_plan = _scoring_plan(plan)
    hallucination_issues = score_hallucination_issues(fixture, scoring_plan, case)
    accuracy_correct = score_accuracy_correct(scoring_plan, case)
    invalidation_correct = False if "mutation" in case else None

    return {
        "case_id": case["case_id"],
        "benchmark_axis": case["benchmark_axis"],
        "category": case["category"],
        "invalidation_kind": invalidation_kind_for_case(case),
        "accuracy_correct": accuracy_correct,
        "hallucination_count": len(hallucination_issues),
        "hallucination_issues": hallucination_issues,
        "invalidation_correct": invalidation_correct,
        "expected_top_award_slug": case.get("expected_top_award_slug"),
        "actual_top_award_slug": scoring_plan["chosen_award_slug"],
        "expected_fallback": case.get("expected_fallback"),
        "actual_fallback": scoring_plan.get("fallback"),
        "status": scoring_plan["status"],
        "token_cost_total": token_cost_total,
        "baseline_plan_record": {
            "plan_type": "baseline_free_text_multiagent",
            "status": "completed",
            "raw_output": {
                "agent_transcript": transcript,
                "final_plan": final_raw_output,
            },
        },
    }


def _fixture_for_case(base_fixture: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    fixture = copy.deepcopy(base_fixture)
    if "mutation" in case:
        _balance_by_slug(fixture, BALANCE_SLUG)["balance_points"] = case["starting_balance_points"]
        fixture = apply_balance_delta(
            fixture,
            BALANCE_SLUG,
            case["mutation"]["delta_points"],
        )
    else:
        _balance_by_slug(fixture, BALANCE_SLUG)["balance_points"] = case["starting_balance_points"]

    for award_slug, changes in case.get("overrides", {}).items():
        _award_by_slug(fixture, award_slug).update(changes)
    return fixture


def _system_prompt(role: str) -> str:
    if role == "coordinator":
        return (
            "You are the coordinator in the Architecture 2 free-text multi-agent baseline. "
            "Use only the supplied seeded facts and prior free-text agent notes. Return exactly one JSON "
            "object with keys: status, chosen_award_slug, fallback, unsupported_reason, ranked_awards, steps. "
            "Do not output dependency edges, graph mutations, plan_steps, or state_dependencies."
        )
    return (
        f"You are the {role} in the Architecture 2 free-text multi-agent baseline. "
        "Use only the supplied seeded facts and prior free-text notes. Return exactly one JSON object "
        "with keys: agent_notes and tool_observations. Do not output dependency edges, graph mutations, "
        "plan_steps, or state_dependencies."
    )


def _user_prompt(
    fixture: dict[str, Any],
    case: dict[str, Any],
    role: str,
    transcript: list[dict[str, Any]],
) -> str:
    prompt_payload = {
        "role": role,
        "benchmark_case": {
            "case_id": case["case_id"],
            "benchmark_axis": case["benchmark_axis"],
            "category": case["category"],
            "query": case["query"],
            "current_balance_points": score_case_current_balance(case),
            "mutation": case.get("mutation"),
            "overrides": case.get("overrides", {}),
        },
        "seeded_context": {
            "scope": fixture["scope"],
            "programs": fixture["programs"],
            "transfer_paths": fixture["transfer_paths"],
            "hotels": fixture["hotels"],
            "award_options": fixture["award_options"],
            "balances": fixture["balances"],
        },
        "prior_free_text_messages": transcript,
        "json_tool_contract": _output_contract_for_role(role),
    }
    return json.dumps(prompt_payload, sort_keys=True)


def _output_contract_for_role(role: str) -> dict[str, Any]:
    if role == "coordinator":
        return {
            "status": "current or unsupported",
            "chosen_award_slug": "award slug string or null",
            "fallback": "cash or null",
            "unsupported_reason": "unsupported_by_seed_fixture when status is unsupported, otherwise null",
            "ranked_awards": [
                {
                    "award_slug": "seeded award slug",
                    "required_source_points": "integer",
                    "candidate_fact_slugs": "seeded fact slugs used",
                }
            ],
            "steps": [
                {
                    "summary": "short user-facing step",
                    "reasoning": "brief reasoning grounded in seeded facts",
                }
            ],
        }
    return {
        "agent_notes": "free-text notes grounded only in seeded facts",
        "tool_observations": [
            {
                "tool": "json fixture/tool name",
                "summary": "short observation using seeded facts only",
            }
        ],
    }


def _parse_raw_output(content: str) -> dict[str, Any]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as error:
        raise BaselineOutputError("free-text baseline output must be valid JSON") from error
    if not isinstance(parsed, dict):
        raise BaselineOutputError("free-text baseline output must be a JSON object")
    return parsed


def _reject_forbidden_output(value: Any) -> None:
    if isinstance(value, dict):
        forbidden = FORBIDDEN_BASELINE_OUTPUT_KEYS.intersection(value)
        if forbidden:
            raise BaselineOutputError(
                f"baseline output may not include dependency/coordination fields: {sorted(forbidden)}"
            )
        for child in value.values():
            _reject_forbidden_output(child)
    elif isinstance(value, list):
        for child in value:
            _reject_forbidden_output(child)


def _normalize_agent_handoff(role: str, raw_output: dict[str, Any]) -> dict[str, Any]:
    notes = raw_output.get("agent_notes")
    if not isinstance(notes, str) or not notes.strip():
        raise BaselineOutputError(f"{role} output must include non-empty agent_notes")
    observations = raw_output.get("tool_observations", [])
    if not isinstance(observations, list):
        raise BaselineOutputError(f"{role} tool_observations must be a list")
    return {
        "role": role,
        "agent_notes": notes,
        "tool_observations": observations,
    }


def _normalize_plan(raw_output: dict[str, Any]) -> dict[str, Any]:
    status = raw_output.get("status")
    if status not in {"current", "unsupported"}:
        raise BaselineOutputError("baseline output status must be current or unsupported")

    chosen_award_slug = raw_output.get("chosen_award_slug")
    if chosen_award_slug is not None and not isinstance(chosen_award_slug, str):
        raise BaselineOutputError("chosen_award_slug must be a string or null")

    fallback = raw_output.get("fallback")
    if fallback is not None and not isinstance(fallback, str):
        raise BaselineOutputError("fallback must be a string or null")

    unsupported_reason = raw_output.get("unsupported_reason")
    if unsupported_reason is not None and not isinstance(unsupported_reason, str):
        raise BaselineOutputError("unsupported_reason must be a string or null")
    if status == "unsupported" and (
        not isinstance(unsupported_reason, str) or not unsupported_reason.strip()
    ):
        raise BaselineOutputError("unsupported output must include unsupported_reason")

    ranked_awards = raw_output.get("ranked_awards")
    if not isinstance(ranked_awards, list):
        raise BaselineOutputError("ranked_awards must be a list")
    normalized_awards = [_normalize_ranked_award(award) for award in ranked_awards]

    steps = raw_output.get("steps")
    if not isinstance(steps, list):
        raise BaselineOutputError("steps must be a list")

    return {
        "status": status,
        "chosen_award_slug": chosen_award_slug,
        "fallback": fallback,
        "unsupported_reason": unsupported_reason,
        "ranked_awards": normalized_awards,
        "steps": steps,
    }


def _normalize_ranked_award(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise BaselineOutputError("ranked_awards entries must be objects")
    award_slug = value.get("award_slug")
    if not isinstance(award_slug, str):
        raise BaselineOutputError("ranked award award_slug must be a string")
    required_source_points = value.get("required_source_points")
    if not isinstance(required_source_points, int):
        raise BaselineOutputError("ranked award required_source_points must be an integer")
    candidate_fact_slugs = value.get("candidate_fact_slugs")
    if not isinstance(candidate_fact_slugs, list) or not all(
        isinstance(slug, str) for slug in candidate_fact_slugs
    ):
        raise BaselineOutputError("ranked award candidate_fact_slugs must be a list of strings")
    return {
        "award_slug": award_slug,
        "required_source_points": required_source_points,
        "candidate_fact_slugs": candidate_fact_slugs,
    }


def _scoring_plan(plan: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": plan["status"],
        "chosen_award_slug": plan["chosen_award_slug"],
        "fallback": plan["fallback"],
        "unsupported_reason": plan["unsupported_reason"],
        "ranked_awards": plan["ranked_awards"],
        "steps": [
            {
                "state_dependencies": [],
                "payload": {},
            }
            for _ in plan["steps"]
        ],
    }


def _balance_by_slug(fixture: dict[str, Any], balance_slug: str) -> dict[str, Any]:
    for balance in fixture["balances"]:
        if balance["slug"] == balance_slug:
            return balance
    raise BaselineOutputError(f"unknown fixture balance slug: {balance_slug}")


def _award_by_slug(fixture: dict[str, Any], award_slug: str) -> dict[str, Any]:
    for award in fixture["award_options"]:
        if award["slug"] == award_slug:
            return award
    raise BaselineOutputError(f"override references unknown award: {award_slug}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the RCG-36 free-text multi-agent LLM baseline."
    )
    parser.add_argument("--fixture", default=str(DEFAULT_FIXTURE_PATH))
    parser.add_argument("--cases", default=str(DEFAULT_CASES_PATH))
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    try:
        client = OpenAIChatCompletionsClient.from_env()
        report = run_free_text_multiagent_baseline(
            llm_client=client,
            fixture_path=args.fixture,
            cases_path=args.cases,
            limit=args.limit,
        )
    except (BaselineConfigError, BaselineOutputError) as error:
        print(str(error), file=sys.stderr)
        return 2

    indent = 2 if args.pretty else None
    print(json.dumps(report, indent=indent, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
