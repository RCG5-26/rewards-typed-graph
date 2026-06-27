import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

from benchmark.run_architecture_benchmark import run_architecture_benchmark
from benchmark.single_agent_baseline import LLMResponse


ROOT = Path(__file__).resolve().parents[2]


class PromptAwareFakeLLMClient:
    def __init__(self, *, prompt_tokens: int, completion_tokens: int) -> None:
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.calls: list[dict[str, str]] = []

    def complete_json(self, *, system_prompt: str, user_prompt: str) -> LLMResponse:
        self.calls.append(
            {
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
            }
        )
        prompt = json.loads(user_prompt)
        role = prompt.get("role")
        if role is not None and role != "coordinator":
            payload = {
                "agent_notes": f"{role} reviewed only the seeded benchmark facts.",
                "tool_observations": [
                    {
                        "tool": "seed_fixture_json",
                        "summary": "The fake client used the supplied fixture facts only.",
                    }
                ],
            }
        else:
            payload = _valid_plan_for_prompt(prompt)
        return LLMResponse(
            content=json.dumps(payload),
            prompt_tokens=self.prompt_tokens,
            completion_tokens=self.completion_tokens,
        )


def _valid_plan_for_prompt(prompt: dict[str, Any]) -> dict[str, Any]:
    balance_points = prompt["benchmark_case"]["current_balance_points"]
    if balance_points >= 45_000:
        return _award_plan(
            award_slug="award:demo_hyatt_ginza:tokyo:3n",
            source_points=45_000,
            cash_quote_slug="quote:cash:demo_hyatt_ginza:tokyo:3n",
        )
    return _award_plan(
        award_slug="award:demo_hyatt_shinjuku:tokyo:3n",
        source_points=30_000,
        cash_quote_slug="quote:cash:demo_hyatt_shinjuku:tokyo:3n",
    )


def _award_plan(
    *,
    award_slug: str,
    source_points: int,
    cash_quote_slug: str,
) -> dict[str, Any]:
    return {
        "status": "current",
        "chosen_award_slug": award_slug,
        "fallback": None,
        "unsupported_reason": None,
        "ranked_awards": [
            {
                "award_slug": award_slug,
                "required_source_points": source_points,
                "candidate_fact_slugs": [
                    award_slug,
                    "transfer:chase_ur:hyatt",
                    cash_quote_slug,
                ],
            }
        ],
        "steps": [
            {
                "summary": "Transfer Chase points to Hyatt and book the seeded Tokyo award.",
                "reasoning": "The plan only uses seeded transfer and award facts.",
            }
        ],
    }


class ArchitectureBenchmarkRunnerTests(unittest.TestCase):
    def test_writes_all_architecture_reports_and_manifest(self) -> None:
        single_agent_client = PromptAwareFakeLLMClient(
            prompt_tokens=11,
            completion_tokens=7,
        )
        free_text_client = PromptAwareFakeLLMClient(
            prompt_tokens=13,
            completion_tokens=5,
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            manifest = run_architecture_benchmark(
                output_dir=temp_dir,
                limit=2,
                single_agent_client=single_agent_client,
                free_text_client=free_text_client,
            )
            output_path = Path(temp_dir)

            for filename in (
                "manifest.json",
                "typed-report.json",
                "single-agent-report.json",
                "free-text-report.json",
                "comparison.json",
            ):
                self.assertTrue((output_path / filename).exists(), filename)

            typed_report = _load_json(output_path / "typed-report.json")
            single_report = _load_json(output_path / "single-agent-report.json")
            free_text_report = _load_json(output_path / "free-text-report.json")
            comparison = _load_json(output_path / "comparison.json")
            saved_manifest = _load_json(output_path / "manifest.json")

        self.assertEqual(manifest["status"], "completed")
        self.assertEqual(saved_manifest["status"], "completed")
        self.assertEqual(typed_report["case_count"], 2)
        self.assertEqual(single_report["case_count"], 2)
        self.assertEqual(free_text_report["case_count"], 2)
        self.assertEqual(comparison["architecture_count"], 3)
        self.assertEqual(comparison["case_count"], 2)
        self.assertEqual(len(single_agent_client.calls), 2)
        self.assertEqual(len(free_text_client.calls), 8)
        self.assertEqual(single_report["metrics"]["token_cost_total"], 36)
        self.assertEqual(free_text_report["metrics"]["token_cost_total"], 144)
        self.assertEqual(
            saved_manifest["artifacts"]["architecture_comparison"]["architecture_count"],
            3,
        )

    def test_cli_requires_both_live_baseline_keys_before_writing_reports(self) -> None:
        env = {
            key: value
            for key in ("PATH", "PYTHONPATH")
            if (value := os.environ.get(key)) is not None
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "run"
            completed = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "benchmark.run_architecture_benchmark",
                    "--limit",
                    "1",
                    "--output-dir",
                    str(output_dir),
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                env=env,
            )

            self.assertEqual(completed.returncode, 2)
            self.assertIn("SINGLE_AGENT_BASELINE_API_KEY", completed.stderr)
            self.assertIn("FREE_TEXT_MULTIAGENT_BASELINE_API_KEY", completed.stderr)
            self.assertFalse(output_dir.exists())


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
