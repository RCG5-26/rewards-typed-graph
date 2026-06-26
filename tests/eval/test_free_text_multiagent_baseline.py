import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from typing import Any

from benchmark.free_text_multiagent_baseline import (
    FREE_TEXT_AGENT_ROLES,
    BaselineConfigError,
    BaselineOutputError,
    DEFAULT_CASES_PATH,
    LLMResponse,
    OpenAIChatCompletionsClient,
    run_free_text_multiagent_baseline,
)


ROOT = Path(__file__).resolve().parents[2]


def _gold_cases() -> list[dict[str, Any]]:
    return json.loads(Path(DEFAULT_CASES_PATH).read_text(encoding="utf-8"))["cases"]


GOLD_CASE_COUNT = len(_gold_cases())
GOLD_INVALIDATION_TOTAL = sum(1 for case in _gold_cases() if "mutation" in case)


class FakeRoleLLMClient:
    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self.responses = list(responses)
        self.calls: list[dict[str, str]] = []

    def complete_json(self, *, system_prompt: str, user_prompt: str) -> LLMResponse:
        self.calls.append(
            {
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
            }
        )
        if not self.responses:
            raise AssertionError("fake LLM client received more calls than responses")
        return LLMResponse(
            content=json.dumps(self.responses.pop(0)),
            prompt_tokens=41,
            completion_tokens=17,
        )


def _agent_note(role: str) -> dict[str, Any]:
    return {
        "agent_notes": f"{role} reviewed the seeded facts and found no unsupported data.",
        "tool_observations": [
            {
                "tool": "seed_fixture_json",
                "summary": "Only seeded Chase, Hyatt, and Tokyo award facts were used.",
            }
        ],
    }


def _valid_final_plan(award_slug: str | None = "award:demo_hyatt_ginza:tokyo:3n") -> dict[str, Any]:
    return {
        "status": "current",
        "chosen_award_slug": award_slug,
        "fallback": None,
        "ranked_awards": [
            {
                "award_slug": "award:demo_hyatt_ginza:tokyo:3n",
                "required_source_points": 45000,
                "candidate_fact_slugs": [
                    "award:demo_hyatt_ginza:tokyo:3n",
                    "transfer:chase_ur:hyatt",
                    "quote:cash:demo_hyatt_ginza:tokyo:3n",
                ],
            }
        ],
        "steps": [
            {
                "summary": "Transfer Chase points to Hyatt and book Demo Hyatt Ginza.",
                "reasoning": "The seeded 1:1 Chase to Hyatt route makes the 45,000 point award affordable.",
            }
        ],
    }


def _responses_for_case(final_plan: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    plan = final_plan or _valid_final_plan()
    return [
        _agent_note("wallet_agent"),
        _agent_note("earning_agent"),
        _agent_note("redemption_agent"),
        plan,
    ]


class FreeTextMultiAgentBaselineTests(unittest.TestCase):
    def test_runs_four_roles_per_case_and_reports_baseline_metrics(self) -> None:
        responses: list[dict[str, Any]] = []
        for _ in range(GOLD_CASE_COUNT):
            responses.extend(_responses_for_case())
        client = FakeRoleLLMClient(responses)

        report = run_free_text_multiagent_baseline(llm_client=client)

        self.assertEqual(report["architecture"], "free_text_multiagent_baseline")
        self.assertEqual(report["case_count"], GOLD_CASE_COUNT)
        self.assertEqual(len(client.calls), GOLD_CASE_COUNT * len(FREE_TEXT_AGENT_ROLES))
        self.assertEqual(
            report["metrics"]["token_cost_total"],
            GOLD_CASE_COUNT * len(FREE_TEXT_AGENT_ROLES) * 58,
        )
        self.assertEqual(report["metrics"]["invalidation_passed"], 0)
        self.assertEqual(report["metrics"]["invalidation_total"], GOLD_INVALIDATION_TOTAL)
        first_record = report["cases"][0]["baseline_plan_record"]
        self.assertEqual(first_record["plan_type"], "baseline_free_text_multiagent")
        self.assertEqual(first_record["status"], "completed")
        self.assertEqual(
            [entry["role"] for entry in first_record["raw_output"]["agent_transcript"]],
            list(FREE_TEXT_AGENT_ROLES),
        )
        self.assertIn("final_plan", first_record["raw_output"])
        self.assertNotIn("plan_steps", first_record)
        self.assertNotIn("state_dependencies", first_record)

    def test_prompts_pass_prior_agent_notes_without_gold_answers_or_secrets(self) -> None:
        client = FakeRoleLLMClient(_responses_for_case())

        run_free_text_multiagent_baseline(llm_client=client, limit=1)

        self.assertEqual(len(client.calls), len(FREE_TEXT_AGENT_ROLES))
        first_prompt = client.calls[0]["user_prompt"]
        second_prompt = client.calls[1]["user_prompt"]
        self.assertIn("Demo Hyatt Ginza", first_prompt)
        self.assertIn("prior_free_text_messages", second_prompt)
        self.assertIn("wallet_agent reviewed the seeded facts", second_prompt)
        self.assertNotIn("expected_top_award_slug", first_prompt)
        self.assertNotIn("accepted_award_slugs", first_prompt)
        self.assertNotIn("OPENAI_API_KEY", first_prompt)
        self.assertNotIn("sk-test-secret", first_prompt)

    def test_rejects_dependency_edge_output_from_any_agent(self) -> None:
        bad_wallet_output = _agent_note("wallet_agent")
        bad_wallet_output["state_dependencies"] = [
            {
                "target_table": "user_balances",
                "observed_version": 1,
            }
        ]
        client = FakeRoleLLMClient([bad_wallet_output])

        with self.assertRaisesRegex(BaselineOutputError, "dependency"):
            run_free_text_multiagent_baseline(llm_client=client, limit=1)

    def test_preserves_unsupported_reason_for_expected_response_scoring(self) -> None:
        unsupported_plan = {
            "status": "unsupported",
            "chosen_award_slug": None,
            "fallback": None,
            "unsupported_reason": "unsupported_by_seed_fixture",
            "ranked_awards": [],
            "steps": [
                {
                    "summary": "Only Hyatt is seeded in this benchmark fixture.",
                    "reasoning": "The supplied free-text handoff has no Marriott facts.",
                }
            ],
        }
        responses: list[dict[str, Any]] = []
        for _ in range(5):
            responses.extend(_responses_for_case())
        responses.extend(_responses_for_case(unsupported_plan))
        client = FakeRoleLLMClient(responses)

        report = run_free_text_multiagent_baseline(llm_client=client, limit=6)
        unsupported_case = report["cases"][-1]

        self.assertEqual(unsupported_case["case_id"], "mvp_006_wrong_program_trap")
        self.assertTrue(unsupported_case["accuracy_correct"])
        self.assertEqual(unsupported_case["status"], "unsupported")

    def test_from_env_rejects_non_numeric_timeout(self) -> None:
        env = {
            "FREE_TEXT_MULTIAGENT_BASELINE_API_KEY": "sk-test-secret",
            "FREE_TEXT_MULTIAGENT_BASELINE_TIMEOUT_SECONDS": "not-a-number",
        }

        with self.assertRaisesRegex(BaselineConfigError, "TIMEOUT_SECONDS"):
            OpenAIChatCompletionsClient.from_env(env)

    def test_cli_requires_api_secret_for_live_llm_path(self) -> None:
        env = {
            key: value
            for key in ("PATH", "PYTHONPATH")
            if (value := os.environ.get(key)) is not None
        }
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "benchmark.free_text_multiagent_baseline",
                "--limit",
                "1",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            env=env,
        )

        self.assertEqual(completed.returncode, 2)
        self.assertIn("FREE_TEXT_MULTIAGENT_BASELINE_API_KEY", completed.stderr)


if __name__ == "__main__":
    unittest.main()
