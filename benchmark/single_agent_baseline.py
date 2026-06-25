"""Single-agent LLM baseline for the Person C benchmark.

The baseline is intentionally outside typed-graph coordination: it receives the
same seeded facts and tool-style results as context, calls one LLM, validates the
final JSON answer, and records only a final baseline plan shape for scoring.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from agents.redemption.planner import apply_balance_delta, load_fixture
from benchmark.person_c_scorer import (
    _accuracy_correct,
    _case_current_balance,
    _hallucination_issues,
    _rate,
)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURE_PATH = ROOT / "fixtures" / "person-c-mvp-seed.json"
DEFAULT_CASES_PATH = ROOT / "benchmark" / "gold" / "person-c-mvp-cases.json"
BALANCE_SLUG = "balance:user_mvp_demo:chase_ur"
EVALUATOR_VERSION = "single-agent-llm-baseline-v1"

DEFAULT_API_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = "gpt-5.5"
API_KEY_ENV = "SINGLE_AGENT_BASELINE_API_KEY"
FALLBACK_API_KEY_ENV = "OPENAI_API_KEY"

FORBIDDEN_BASELINE_OUTPUT_KEYS = {
    "dependency_edges",
    "graph_mutations",
    "plan_steps",
    "state_dependencies",
}


class BaselineConfigError(RuntimeError):
    """Raised when the live LLM baseline is not configured."""


class BaselineOutputError(ValueError):
    """Raised when the LLM returns malformed or benchmark-contaminating JSON."""


@dataclass(frozen=True)
class LLMResponse:
    """A JSON text completion plus token accounting from the provider."""

    content: str
    prompt_tokens: int = 0
    completion_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


class LLMClient(Protocol):
    """Minimal boundary for one JSON-only single-agent LLM call."""

    def complete_json(self, *, system_prompt: str, user_prompt: str) -> LLMResponse: ...


class OpenAIChatCompletionsClient:
    """Small stdlib client for OpenAI-compatible chat-completions JSON calls."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        api_url: str = DEFAULT_API_URL,
        timeout_seconds: int = 60,
    ) -> None:
        if not api_key.strip():
            raise BaselineConfigError(f"{API_KEY_ENV} must be non-empty")
        self.api_key = api_key
        self.model = model
        self.api_url = api_url
        self.timeout_seconds = timeout_seconds

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "OpenAIChatCompletionsClient":
        source = env or os.environ
        api_key = source.get(API_KEY_ENV) or source.get(FALLBACK_API_KEY_ENV)
        if api_key is None:
            raise BaselineConfigError(
                f"set {API_KEY_ENV} (or {FALLBACK_API_KEY_ENV}) to run the live LLM baseline"
            )
        return cls(
            api_key=api_key,
            model=source.get("SINGLE_AGENT_BASELINE_MODEL", DEFAULT_MODEL),
            api_url=source.get("SINGLE_AGENT_BASELINE_API_URL", DEFAULT_API_URL),
            timeout_seconds=int(source.get("SINGLE_AGENT_BASELINE_TIMEOUT_SECONDS", "60")),
        )

    def complete_json(self, *, system_prompt: str, user_prompt: str) -> LLMResponse:
        payload = {
            "model": self.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        request = urllib.request.Request(
            self.api_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                body = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise BaselineConfigError(
                f"LLM baseline provider returned HTTP {error.code}: {_redact_secret(detail, self.api_key)}"
            ) from error
        except urllib.error.URLError as error:
            raise BaselineConfigError(f"LLM baseline provider request failed: {error.reason}") from error

        choices = body.get("choices")
        if not choices:
            raise BaselineOutputError("LLM response did not include choices")
        message = choices[0].get("message", {})
        content = message.get("content")
        if not isinstance(content, str):
            raise BaselineOutputError("LLM response content must be a string")
        usage = body.get("usage", {})
        return LLMResponse(
            content=content,
            prompt_tokens=int(usage.get("prompt_tokens") or 0),
            completion_tokens=int(usage.get("completion_tokens") or 0),
        )


def run_single_agent_baseline(
    *,
    llm_client: LLMClient,
    fixture_path: str | Path = DEFAULT_FIXTURE_PATH,
    cases_path: str | Path = DEFAULT_CASES_PATH,
    limit: int | None = None,
) -> dict[str, Any]:
    """Run one LLM call per benchmark case and return a scorer-shaped report."""

    fixture = load_fixture(fixture_path)
    benchmark = load_fixture(cases_path)
    cases = benchmark["cases"][:limit] if limit is not None else benchmark["cases"]
    case_results = [_run_case(llm_client, fixture, case) for case in cases]
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
    token_cost_total = sum(result["token_cost_total"] for result in case_results)

    return {
        "benchmark_id": benchmark["benchmark_id"],
        "fixture_id": fixture["fixture_id"],
        "architecture": "single_agent_llm_baseline",
        "evaluator_version": EVALUATOR_VERSION,
        "case_count": len(case_results),
        "metrics": {
            "accuracy_passed": sum(1 for result in case_results if result["accuracy_correct"]),
            "accuracy_total": len(case_results),
            "accuracy_rate": _rate(
                sum(1 for result in case_results if result["accuracy_correct"]),
                len(case_results),
            ),
            "strict_hallucination_count": sum(
                result["hallucination_count"]
                for result in case_results
            ),
            "strict_hallucination_rate": _rate(
                len(hallucination_cases),
                len(case_results),
            ),
            "invalidation_passed": sum(
                1
                for result in invalidation_results
                if result["invalidation_correct"]
            ),
            "invalidation_total": len(invalidation_results),
            "invalidation_rate": _rate(
                sum(
                    1
                    for result in invalidation_results
                    if result["invalidation_correct"]
                ),
                len(invalidation_results),
            ),
            "token_cost_total": token_cost_total,
        },
        "cases": case_results,
    }


def _run_case(
    llm_client: LLMClient,
    base_fixture: dict[str, Any],
    case: dict[str, Any],
) -> dict[str, Any]:
    fixture = _fixture_for_case(base_fixture, case)
    system_prompt = _system_prompt()
    user_prompt = _user_prompt(fixture, case)
    llm_response = llm_client.complete_json(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
    )
    raw_output = _parse_raw_output(llm_response.content)
    _reject_forbidden_output(raw_output)
    plan = _normalize_plan(raw_output)
    scoring_plan = _scoring_plan(plan)
    hallucination_issues = _hallucination_issues(fixture, scoring_plan, case)
    accuracy_correct = _accuracy_correct(scoring_plan, case)
    invalidation_correct = False if "mutation" in case else None

    return {
        "case_id": case["case_id"],
        "category": case["category"],
        "accuracy_correct": accuracy_correct,
        "hallucination_count": len(hallucination_issues),
        "hallucination_issues": hallucination_issues,
        "invalidation_correct": invalidation_correct,
        "expected_top_award_slug": case.get("expected_top_award_slug"),
        "actual_top_award_slug": scoring_plan["chosen_award_slug"],
        "expected_fallback": case.get("expected_fallback"),
        "actual_fallback": scoring_plan.get("fallback"),
        "status": scoring_plan["status"],
        "token_cost_total": llm_response.total_tokens,
        "baseline_plan_record": {
            "plan_type": "baseline_single_agent",
            "status": "completed",
            "raw_output": raw_output,
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


def _system_prompt() -> str:
    return (
        "You are the Architecture 1 single-agent baseline for a rewards benchmark. "
        "Use only the facts supplied in the user prompt. Do not invent programs, hotels, "
        "award prices, transfer ratios, or availability. Return exactly one JSON object "
        "with keys: status, chosen_award_slug, fallback, ranked_awards, steps. "
        "Do not output dependency edges, graph mutations, plan_steps, or state_dependencies."
    )


def _user_prompt(fixture: dict[str, Any], case: dict[str, Any]) -> str:
    prompt_payload = {
        "benchmark_case": {
            "case_id": case["case_id"],
            "category": case["category"],
            "query": case["query"],
            "current_balance_points": _case_current_balance(case),
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
        "output_contract": {
            "status": "current or unsupported",
            "chosen_award_slug": "award slug string or null",
            "fallback": "cash or null",
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
        },
    }
    return json.dumps(prompt_payload, sort_keys=True)


def _parse_raw_output(content: str) -> dict[str, Any]:
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as error:
        raise BaselineOutputError("LLM baseline output must be valid JSON") from error
    if not isinstance(parsed, dict):
        raise BaselineOutputError("LLM baseline output must be a JSON object")
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


def _redact_secret(text: str, secret: str) -> str:
    if not secret:
        return text
    return text.replace(secret, "[redacted]")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the RCG-35 single-agent LLM baseline.")
    parser.add_argument("--fixture", default=str(DEFAULT_FIXTURE_PATH))
    parser.add_argument("--cases", default=str(DEFAULT_CASES_PATH))
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--pretty", action="store_true")
    args = parser.parse_args()

    try:
        client = OpenAIChatCompletionsClient.from_env()
        report = run_single_agent_baseline(
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
