"""Build the frontend-facing architecture-comparison report from real benchmark runs.

Produces `lib/benchmark/architecture-comparison.json` — the **captured real
evidence** the console's baselines/benchmark tabs render (no fabricated constants).

- The typed-graph architecture is always scored live here (fixture-backed scorer
  in `benchmark.person_c_scorer`; no API key, deterministic).
- The two LLM baselines (`single_agent_llm_baseline`, `free_text_multiagent_baseline`)
  require a paid LLM key, so they are picked up from committed report files under
  `benchmark/reports/` **only if present**. Otherwise they are marked `not_run`
  with the exact command to produce them — never fabricated.

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
