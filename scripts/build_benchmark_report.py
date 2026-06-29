"""Build the frontend-facing architecture-comparison report from real benchmark runs.

Produces `lib/benchmark/architecture-comparison.json` — the **captured real
evidence** the console's baselines/benchmark tabs render (no fabricated constants).

- The typed-graph architecture is always scored live here (fixture-backed scorer
  in `benchmark.person_c_scorer`; no API key, deterministic).
- The two LLM baselines (`single_agent_llm_baseline`, `free_text_multiagent_baseline`)
  require a paid LLM key, so they are picked up from committed report files under
  `benchmark/reports/` only if present and fully comparable with the typed report.
  Missing baselines are marked `not_run`; partial or mismatched baseline reports
  fail the build instead of being published.

Usage:
    python scripts/build_benchmark_report.py
    # then, to fill the baselines (needs an LLM key):
    OPENAI_API_KEY=... python -m benchmark.single_agent_baseline > benchmark/reports/single_agent_llm_baseline.json
    OPENAI_API_KEY=... python -m benchmark.free_text_multiagent_baseline > benchmark/reports/free_text_multiagent_baseline.json
    python scripts/build_benchmark_report.py   # re-run to merge them in
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from benchmark.person_c_scorer import run_benchmark  # noqa: E402
REPORTS_DIR = REPO_ROOT / "benchmark" / "reports"
OUTPUT_PATH = REPO_ROOT / "lib" / "benchmark" / "architecture-comparison.json"

# Display metadata + the command that produces each architecture's report.
ARCHITECTURES: tuple[dict[str, str], ...] = (
    {
        "key": "typed_graph_fixture",
        "label": "Typed graph",
        "run": "python -m benchmark.person_c_scorer",
    },
    {
        "key": "free_text_multiagent_baseline",
        "label": "CrewAI (free-text)",
        "run": "OPENAI_API_KEY=... python -m benchmark.free_text_multiagent_baseline > benchmark/reports/free_text_multiagent_baseline.json",
    },
    {
        "key": "single_agent_llm_baseline",
        "label": "Single agent",
        "run": "OPENAI_API_KEY=... python -m benchmark.single_agent_baseline > benchmark/reports/single_agent_llm_baseline.json",
    },
)


def _normalize(report: dict[str, Any]) -> dict[str, Any]:
    """Project a raw architecture report's metrics into the FE-facing shape."""
    m = report["metrics"]
    return {
        "status": "measured",
        "caseCount": report["case_count"],
        "accuracyRate": m["accuracy_rate"],
        "accuracyPassed": m["accuracy_passed"],
        "accuracyTotal": m["accuracy_total"],
        "hallucinationCount": m["strict_hallucination_count"],
        "hallucinationRate": m["strict_hallucination_rate"],
        "invalidationRate": m["invalidation_rate"],
        "invalidationPassed": m["invalidation_passed"],
        "invalidationTotal": m["invalidation_total"],
        # Only present once token instrumentation (agent_runs.token_count) is live.
        "tokenCostTotal": m.get("token_cost_total"),
    }


def _load_baseline(key: str) -> dict[str, Any] | None:
    path = REPORTS_DIR / f"{key}.json"
    if not path.exists() or path.stat().st_size == 0:
        return None
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return None
    try:
        report = json.loads(text)
    except json.JSONDecodeError:
        # A failed/partial run (e.g. missing API key wrote nothing) — treat as
        # not_run rather than breaking the build.
        print(f"  warning: {path.relative_to(REPO_ROOT)} is not valid JSON; treating as not_run")
        return None
    if report.get("architecture") != key:
        raise ValueError(f"{path} architecture mismatch: expected {key}, got {report.get('architecture')}")
    return report


def _validate_baseline_report(report: dict[str, Any], typed: dict[str, Any]) -> None:
    """Fail fast when a baseline file is not a full comparable benchmark run."""
    architecture = report.get("architecture")
    for field_name in ("benchmark_id", "fixture_id"):
        if report.get(field_name) != typed.get(field_name):
            raise ValueError(
                f"{architecture} report must share {field_name} with typed report"
            )

    if report.get("metric_definitions") != typed.get("metric_definitions"):
        raise ValueError(f"{architecture} report must share metric definitions")

    expected_case_ids = _case_ids(typed)
    if _case_ids(report) != expected_case_ids:
        raise ValueError(
            f"{architecture} report must include the full ordered case list"
        )

    expected_case_count = typed["case_count"]
    if report.get("case_count") != expected_case_count:
        raise ValueError(
            f"{architecture} report case_count must be {expected_case_count}"
        )

    metrics = report.get("metrics", {})
    if metrics.get("accuracy_total") != expected_case_count:
        raise ValueError(
            f"{architecture} report accuracy_total must be {expected_case_count}"
        )

    hallucination_case_ids = metrics.get("strict_hallucination_case_ids")
    if not isinstance(hallucination_case_ids, list):
        raise ValueError(
            f"{architecture} report must include strict_hallucination_case_ids"
        )
    if metrics.get("strict_hallucination_case_count") != len(hallucination_case_ids):
        raise ValueError(
            f"{architecture} report strict_hallucination_case_count must match "
            "strict_hallucination_case_ids"
        )
    unexpected_hallucination_ids = sorted(
        set(hallucination_case_ids) - set(expected_case_ids)
    )
    if unexpected_hallucination_ids:
        raise ValueError(
            f"{architecture} report includes hallucination case ids outside the "
            f"benchmark corpus: {unexpected_hallucination_ids}"
        )

    expected_invalidation_total = typed["metrics"]["invalidation_total"]
    if metrics.get("invalidation_total") != expected_invalidation_total:
        raise ValueError(
            f"{architecture} report invalidation_total must be "
            f"{expected_invalidation_total}"
        )


def _case_ids(report: dict[str, Any]) -> list[str]:
    cases = report.get("cases")
    if not isinstance(cases, list):
        raise ValueError(f"{report.get('architecture')} report must include cases")
    return [case["case_id"] for case in cases]


def build() -> dict[str, Any]:
    typed = run_benchmark()
    architectures = []
    for arch in ARCHITECTURES:
        key = arch["key"]
        raw = typed if key == "typed_graph_fixture" else _load_baseline(key)
        entry = {"key": key, "label": arch["label"]}
        if raw is None:
            entry.update({"status": "not_run", "run": arch["run"]})
        else:
            if key != "typed_graph_fixture":
                _validate_baseline_report(raw, typed)
            entry.update(_normalize(raw))
        architectures.append(entry)

    return {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "benchmarkId": typed["benchmark_id"],
        "fixtureId": typed["fixture_id"],
        "evaluatorVersion": typed["evaluator_version"],
        "caseCount": typed["case_count"],
        "note": (
            "Captured real benchmark evidence. Typed-graph metrics are scored live "
            "by the fixture-backed scorer; LLM baselines require a paid key and are "
            "marked not_run until their report files exist under benchmark/reports/."
        ),
        "architectures": architectures,
    }


def main() -> int:
    report = build()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    measured = [a["key"] for a in report["architectures"] if a.get("status") == "measured"]
    not_run = [a["key"] for a in report["architectures"] if a.get("status") == "not_run"]
    print(f"wrote {OUTPUT_PATH.relative_to(REPO_ROOT)}")
    print(f"  measured: {', '.join(measured) or 'none'}")
    print(f"  not_run:  {', '.join(not_run) or 'none'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
