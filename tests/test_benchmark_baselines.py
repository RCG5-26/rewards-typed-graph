"""Tests for the LLM baseline runners (RCG-35/36).

These lock down the behaviors CodeRabbit flagged as untested on PR #52:
  * per-case progress is emitted to stderr while the JSON report shape is stable,
  * `SINGLE_AGENT_BASELINE_TEMPERATURE` is parsed and only sent when set.

No network or API key is used: the LLM boundary is a fake `complete_json`, and
the one provider-payload test stubs `urllib.request.urlopen`.
"""

from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stderr
from unittest.mock import patch

from benchmark import free_text_multiagent_baseline as free_text
from benchmark import single_agent_baseline as single_agent
from benchmark.single_agent_baseline import (
    BaselineConfigError,
    LLMResponse,
    OpenAIChatCompletionsClient,
)

# One JSON blob valid for BOTH baselines: it carries the coordinator/plan keys
# (`status` … `steps`) and the role-handoff keys (`agent_notes`,
# `tool_observations`), so a single fake client drives every call type.
_FAKE_OUTPUT = {
    "status": "unsupported",
    "chosen_award_slug": None,
    "fallback": "cash",
    "unsupported_reason": "unsupported_by_seed_fixture",
    "ranked_awards": [],
    "steps": [],
    "agent_notes": "grounded note",
    "tool_observations": [],
}


class _FakeLLMClient:
    """Records calls and returns a fixed, contract-valid JSON completion."""

    def __init__(self) -> None:
        self.calls = 0

    def complete_json(self, *, system_prompt: str, user_prompt: str) -> LLMResponse:
        self.calls += 1
        return LLMResponse(content=json.dumps(_FAKE_OUTPUT), prompt_tokens=3, completion_tokens=4)


class SingleAgentProgressTest(unittest.TestCase):
    def test_emits_per_case_stderr_progress_and_stable_report(self) -> None:
        client = _FakeLLMClient()
        err = io.StringIO()
        with redirect_stderr(err):
            report = single_agent.run_single_agent_baseline(llm_client=client, limit=2)

        lines = [line for line in err.getvalue().splitlines() if line.strip()]
        self.assertEqual(len(lines), 2)
        self.assertTrue(all(line.startswith("[single-agent]") for line in lines))
        self.assertIn("1/2", lines[0])
        self.assertIn("2/2", lines[1])

        # Report shape is unchanged by the progress side effect.
        self.assertEqual(report["architecture"], "single_agent_llm_baseline")
        self.assertEqual(report["case_count"], 2)
        self.assertEqual(len(report["cases"]), 2)
        self.assertIn("metrics", report)


class FreeTextProgressTest(unittest.TestCase):
    def test_emits_per_case_stderr_progress_and_stable_report(self) -> None:
        client = _FakeLLMClient()
        err = io.StringIO()
        with redirect_stderr(err):
            report = free_text.run_free_text_multiagent_baseline(llm_client=client, limit=2)

        lines = [line for line in err.getvalue().splitlines() if line.strip()]
        self.assertEqual(len(lines), 2)
        self.assertTrue(all(line.startswith("[free-text]") for line in lines))
        self.assertIn("1/2", lines[0])
        self.assertIn("2/2", lines[1])

        self.assertEqual(report["architecture"], "free_text_multiagent_baseline")
        self.assertEqual(report["case_count"], 2)
        # One LLM call per role (4), per case (2).
        self.assertEqual(client.calls, len(free_text.FREE_TEXT_AGENT_ROLES) * 2)


class TemperatureConfigTest(unittest.TestCase):
    def test_temperature_is_none_when_env_unset(self) -> None:
        client = OpenAIChatCompletionsClient.from_env({"OPENAI_API_KEY": "k"})
        self.assertIsNone(client.temperature)

    def test_temperature_parsed_as_float_when_set(self) -> None:
        client = OpenAIChatCompletionsClient.from_env(
            {"OPENAI_API_KEY": "k", "SINGLE_AGENT_BASELINE_TEMPERATURE": "0.5"}
        )
        self.assertEqual(client.temperature, 0.5)

    def test_invalid_temperature_raises_config_error(self) -> None:
        with self.assertRaises(BaselineConfigError):
            OpenAIChatCompletionsClient.from_env(
                {"OPENAI_API_KEY": "k", "SINGLE_AGENT_BASELINE_TEMPERATURE": "warm"}
            )


class _FakeHTTPResponse:
    def __init__(self, body: dict) -> None:
        self._body = json.dumps(body).encode("utf-8")

    def __enter__(self) -> "_FakeHTTPResponse":
        return self

    def __exit__(self, *exc) -> None:
        return None

    def read(self) -> bytes:
        return self._body


class TemperaturePayloadTest(unittest.TestCase):
    """`temperature` is omitted from the request payload unless explicitly set."""

    _RESPONSE = {
        "choices": [{"message": {"content": "{}"}}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1},
    }

    def _captured_payload(self, *, temperature: float | None) -> dict:
        captured: dict = {}

        def fake_urlopen(request, timeout=None):  # noqa: ANN001 - stdlib signature
            captured.update(json.loads(request.data.decode("utf-8")))
            return _FakeHTTPResponse(self._RESPONSE)

        client = OpenAIChatCompletionsClient(api_key="k", model="m", temperature=temperature)
        with patch("benchmark.single_agent_baseline.urllib.request.urlopen", fake_urlopen):
            client.complete_json(system_prompt="s", user_prompt="u")
        return captured

    def test_temperature_omitted_when_unset(self) -> None:
        self.assertNotIn("temperature", self._captured_payload(temperature=None))

    def test_temperature_sent_when_set(self) -> None:
        payload = self._captured_payload(temperature=0.2)
        self.assertEqual(payload["temperature"], 0.2)


if __name__ == "__main__":
    unittest.main()
