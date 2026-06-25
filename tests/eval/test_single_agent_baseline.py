import json
import subprocess
import sys
import unittest
from pathlib import Path
from typing import Any
from unittest.mock import patch

from benchmark.single_agent_baseline import (
    BaselineOutputError,
    LLMResponse,
    OpenAIChatCompletionsClient,
    run_single_agent_baseline,
)


ROOT = Path(__file__).resolve().parents[2]


class FakeLLMClient:
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
            prompt_tokens=101,
            completion_tokens=23,
        )


def _valid_llm_plan(award_slug: str | None = "award:demo_hyatt_ginza:tokyo:3n") -> dict[str, Any]:
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


class SingleAgentBaselineTests(unittest.TestCase):
    def test_runs_llm_once_per_case_and_reports_baseline_metrics(self) -> None:
        expected_case_count = 11
        client = FakeLLMClient([_valid_llm_plan() for _ in range(expected_case_count)])

        report = run_single_agent_baseline(llm_client=client)

        self.assertEqual(report["architecture"], "single_agent_llm_baseline")
        self.assertEqual(report["case_count"], expected_case_count)
        self.assertEqual(len(client.calls), expected_case_count)
        self.assertEqual(report["metrics"]["token_cost_total"], expected_case_count * 124)
        self.assertEqual(report["metrics"]["invalidation_passed"], 0)
        self.assertEqual(report["metrics"]["invalidation_total"], 2)
        self.assertEqual(report["cases"][0]["baseline_plan_record"]["plan_type"], "baseline_single_agent")
        self.assertEqual(report["cases"][0]["baseline_plan_record"]["status"], "completed")
        self.assertIn("raw_output", report["cases"][0]["baseline_plan_record"])
        self.assertNotIn("plan_steps", report["cases"][0]["baseline_plan_record"])
        self.assertNotIn("state_dependencies", report["cases"][0]["baseline_plan_record"])

    def test_prompt_includes_fixture_context_without_expected_answers_or_secrets(self) -> None:
        client = FakeLLMClient([_valid_llm_plan() for _ in range(11)])

        run_single_agent_baseline(llm_client=client)
        first_prompt = client.calls[0]["user_prompt"]

        self.assertIn("Demo Hyatt Ginza", first_prompt)
        self.assertIn("transfer:chase_ur:hyatt", first_prompt)
        self.assertIn("current_balance_points", first_prompt)
        self.assertNotIn("expected_top_award_slug", first_prompt)
        self.assertNotIn("accepted_award_slugs", first_prompt)
        self.assertNotIn("OPENAI_API_KEY", first_prompt)
        self.assertNotIn("sk-test-secret", first_prompt)

    def test_rejects_dependency_edge_output_from_baseline(self) -> None:
        bad_plan = _valid_llm_plan()
        bad_plan["state_dependencies"] = [
            {
                "target_table": "user_balances",
                "observed_version": 1,
            }
        ]
        client = FakeLLMClient([bad_plan])

        with self.assertRaisesRegex(BaselineOutputError, "dependency"):
            run_single_agent_baseline(llm_client=client)

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
                    "reasoning": "The supplied context has no Marriott transfer path or Marriott award facts.",
                }
            ],
        }
        client = FakeLLMClient([_valid_llm_plan() for _ in range(5)] + [unsupported_plan])

        report = run_single_agent_baseline(llm_client=client, limit=6)
        unsupported_case = report["cases"][-1]

        self.assertEqual(unsupported_case["case_id"], "mvp_006_wrong_program_trap")
        self.assertTrue(unsupported_case["accuracy_correct"])
        self.assertEqual(unsupported_case["status"], "unsupported")

    def test_rejects_non_json_llm_output(self) -> None:
        class BadJsonClient:
            def complete_json(self, *, system_prompt: str, user_prompt: str) -> LLMResponse:
                return LLMResponse(content="not json", prompt_tokens=1, completion_tokens=1)

        with self.assertRaisesRegex(BaselineOutputError, "valid JSON"):
            run_single_agent_baseline(llm_client=BadJsonClient())

    def test_http_llm_client_sends_secret_only_in_authorization_header(self) -> None:
        captured: dict[str, Any] = {}

        class FakeHttpResponse:
            def __enter__(self) -> "FakeHttpResponse":
                return self

            def __exit__(self, exc_type: object, exc: object, tb: object) -> bool:
                return False

            def read(self) -> bytes:
                return json.dumps(
                    {
                        "choices": [
                            {
                                "message": {
                                    "content": json.dumps(_valid_llm_plan()),
                                }
                            }
                        ],
                        "usage": {
                            "prompt_tokens": 17,
                            "completion_tokens": 19,
                        },
                    }
                ).encode("utf-8")

        def fake_urlopen(request: Any, timeout: int) -> FakeHttpResponse:
            captured["authorization"] = request.headers.get("Authorization")
            captured["body"] = json.loads(request.data.decode("utf-8"))
            captured["timeout"] = timeout
            return FakeHttpResponse()

        with patch("urllib.request.urlopen", fake_urlopen):
            client = OpenAIChatCompletionsClient(
                api_key="sk-test-secret",
                model="baseline-test-model",
                api_url="https://example.test/v1/chat/completions",
                timeout_seconds=9,
            )
            response = client.complete_json(
                system_prompt="system",
                user_prompt="user",
            )

        self.assertEqual(captured["authorization"], "Bearer sk-test-secret")
        self.assertNotIn("sk-test-secret", json.dumps(captured["body"]))
        self.assertEqual(captured["timeout"], 9)
        self.assertEqual(captured["body"]["model"], "baseline-test-model")
        self.assertEqual(captured["body"]["response_format"], {"type": "json_object"})
        self.assertEqual(response.total_tokens, 36)

    def test_cli_requires_api_secret_for_live_llm_path(self) -> None:
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "benchmark.single_agent_baseline",
                "--limit",
                "1",
            ],
            cwd=ROOT,
            capture_output=True,
            text=True,
            env={},
        )

        self.assertEqual(completed.returncode, 2)
        self.assertIn("SINGLE_AGENT_BASELINE_API_KEY", completed.stderr)


if __name__ == "__main__":
    unittest.main()
