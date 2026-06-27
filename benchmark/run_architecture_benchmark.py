"""Run RCG-37 across typed graph, single-agent, and free-text architectures."""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from benchmark.architecture_comparison import build_architecture_comparison
from benchmark.free_text_multiagent_baseline import (
    OpenAIChatCompletionsClient as FreeTextClient,
    run_free_text_multiagent_baseline,
)
from benchmark.person_c_scorer import (
    DEFAULT_CASES_PATH,
    DEFAULT_FIXTURE_PATH,
    run_benchmark,
)
from benchmark.single_agent_baseline import (
    BaselineConfigError,
    BaselineOutputError,
    LLMClient,
    OpenAIChatCompletionsClient as SingleAgentClient,
    run_single_agent_baseline,
)


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_ROOT = ROOT / "benchmark" / "runs"
MANIFEST_VERSION = "rcg-37-run-manifest-v1"


class BenchmarkRunError(RuntimeError):
    """Raised when the cross-architecture benchmark cannot be run honestly."""


def run_architecture_benchmark(
    *,
    output_dir: str | Path,
    fixture_path: str | Path = DEFAULT_FIXTURE_PATH,
    cases_path: str | Path = DEFAULT_CASES_PATH,
    limit: int | None = None,
    env: dict[str, str] | None = None,
    single_agent_client: LLMClient | None = None,
    free_text_client: LLMClient | None = None,
) -> dict[str, Any]:
    """Run all three benchmark architectures and write durable JSON artifacts."""
    single_agent_client, free_text_client = _resolve_clients(
        env=env,
        single_agent_client=single_agent_client,
        free_text_client=free_text_client,
    )

    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    generated_at = _utc_now()
    manifest: dict[str, Any] = {
        "manifest_version": MANIFEST_VERSION,
        "generated_at": generated_at,
        "status": "running",
        "fixture_path": str(fixture_path),
        "cases_path": str(cases_path),
        "limit": limit,
        "artifacts": {},
    }
    _write_json(output_path / "manifest.json", manifest)

    try:
        typed_report = run_benchmark(fixture_path, cases_path, limit=limit)
        _record_artifact(
            manifest,
            "typed_graph_fixture",
            output_path / "typed-report.json",
            typed_report,
        )

        single_agent_report = run_single_agent_baseline(
            llm_client=single_agent_client,
            fixture_path=fixture_path,
            cases_path=cases_path,
            limit=limit,
        )
        _record_artifact(
            manifest,
            "single_agent_llm_baseline",
            output_path / "single-agent-report.json",
            single_agent_report,
        )

        free_text_report = run_free_text_multiagent_baseline(
            llm_client=free_text_client,
            fixture_path=fixture_path,
            cases_path=cases_path,
            limit=limit,
        )
        _record_artifact(
            manifest,
            "free_text_multiagent_baseline",
            output_path / "free-text-report.json",
            free_text_report,
        )

        comparison = build_architecture_comparison(
            [typed_report, single_agent_report, free_text_report]
        )
        _record_artifact(
            manifest,
            "architecture_comparison",
            output_path / "comparison.json",
            comparison,
        )
    except (BaselineConfigError, BaselineOutputError, ValueError) as error:
        manifest["status"] = "failed"
        manifest["error"] = str(error)
        _write_json(output_path / "manifest.json", manifest)
        raise BenchmarkRunError(str(error)) from error

    manifest["status"] = "completed"
    manifest["completed_at"] = _utc_now()
    _write_json(output_path / "manifest.json", manifest)
    return manifest


def _resolve_clients(
    *,
    env: dict[str, str] | None,
    single_agent_client: LLMClient | None,
    free_text_client: LLMClient | None,
) -> tuple[LLMClient, LLMClient]:
    source = env or os.environ
    errors: list[str] = []

    if single_agent_client is None:
        try:
            single_agent_client = SingleAgentClient.from_env(source)
        except BaselineConfigError as error:
            errors.append(str(error))

    if free_text_client is None:
        try:
            free_text_client = FreeTextClient.from_env(source)
        except BaselineConfigError as error:
            errors.append(str(error))

    if errors:
        raise BenchmarkRunError("; ".join(errors))
    if single_agent_client is None or free_text_client is None:
        raise BenchmarkRunError("benchmark LLM clients were not initialized")
    return single_agent_client, free_text_client


def _record_artifact(
    manifest: dict[str, Any],
    key: str,
    path: Path,
    payload: dict[str, Any],
) -> None:
    _write_json(path, payload)
    manifest["artifacts"][key] = {
        "path": str(path),
        "architecture": payload.get("architecture"),
        "case_count": payload.get("case_count"),
        "architecture_count": payload.get("architecture_count"),
        "metrics": payload.get("metrics"),
    }
    _write_json(path.parent / "manifest.json", manifest)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _default_output_dir() -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return DEFAULT_OUTPUT_ROOT / stamp


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run RCG-37 and write typed, single-agent, free-text, and comparison reports."
    )
    parser.add_argument("--fixture", default=str(DEFAULT_FIXTURE_PATH))
    parser.add_argument("--cases", default=str(DEFAULT_CASES_PATH))
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--output-dir", default=None)
    args = parser.parse_args()

    output_dir = Path(args.output_dir) if args.output_dir else _default_output_dir()
    try:
        manifest = run_architecture_benchmark(
            output_dir=output_dir,
            fixture_path=args.fixture,
            cases_path=args.cases,
            limit=args.limit,
        )
    except BenchmarkRunError as error:
        print(str(error), file=sys.stderr)
        return 2

    print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
