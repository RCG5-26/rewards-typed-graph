# Person C Benchmark

This folder holds the seeded Person C benchmark artifacts. The gold corpus has
30 executable queries: 10 earning, 10 redemption, and 10 portfolio cases.
The gold file also carries the RCG-31 fixture manifest that freezes the seed
fixture, world scope, and excluded live sources for scoring.

## Run The Current Scorer

```bash
python -m benchmark.person_c_scorer --pretty
```

The gold file's `scoring_rules.expected_axis_counts` records the **required case count per `benchmark_axis`** (10 earning, 10 redemption, 10 portfolio). Tests assert the corpus matches those totals exactly — they are not sampling weights.

The scorer runs the fixture-backed typed path against `benchmark/gold/person-c-mvp-cases.json` and reports:

- accuracy
- strict hallucination count, case rate, issue counts, and RCG-34 definition
- invalidation correctness plus RCG-38 wins by invalidation kind
- benchmark-axis and category counts

The typed-graph scorer and baseline runners reuse the shared metric definitions
in `benchmark/metric_summary.py` so every architecture reports the same shape.

## Run The RCG-35 Single-Agent LLM Baseline

```bash
OPENAI_API_KEY=... \
python -m benchmark.single_agent_baseline --pretty
```

Optional knobs:

- `SINGLE_AGENT_BASELINE_API_KEY` (dedicated override; falls back to `OPENAI_API_KEY`)
- `SINGLE_AGENT_BASELINE_MODEL` (default: `gpt-5.5`)
- `SINGLE_AGENT_BASELINE_API_URL` (default: OpenAI-compatible chat completions)
- `SINGLE_AGENT_BASELINE_TIMEOUT_SECONDS` (default: `60`)

The runner makes one JSON-only LLM call per benchmark case. It supplies the same seeded fixture/tool facts as context, but the output is treated as a baseline sink only: `plan_type = baseline_single_agent`, final raw output, no `plan_steps`, no `state_dependencies`, and no graph-mutation coordination. Invalidation cases therefore receive no structural invalidation credit by design, and the RCG-38 report shows 0 wins for each invalidation kind.

## Run The RCG-36 Free-Text Multi-Agent Baseline

```bash
OPENAI_API_KEY=... \
python -m benchmark.free_text_multiagent_baseline --pretty
```

Optional knobs:

- `FREE_TEXT_MULTIAGENT_BASELINE_API_KEY` (dedicated override; falls back to `OPENAI_API_KEY`)
- `FREE_TEXT_MULTIAGENT_BASELINE_MODEL` (default: `gpt-5.5`)
- `FREE_TEXT_MULTIAGENT_BASELINE_API_URL` (default: OpenAI-compatible chat completions)
- `FREE_TEXT_MULTIAGENT_BASELINE_TIMEOUT_SECONDS` (default: `60`)

The runner makes four JSON-only LLM calls per benchmark case: wallet agent,
earning agent, redemption agent, and coordinator. The first three roles pass
free-text notes forward; the coordinator returns the final baseline plan. The
report uses the same metric definitions as the typed-graph scorer and the
single-agent baseline, but it remains a baseline sink only: no graph mutations,
no `plan_steps`, and no `state_dependencies`.

## Build The RCG-37 Architecture Comparison

Use the aggregate runner when producing the demo head-to-head numbers:

```bash
OPENAI_API_KEY=... \
python -m benchmark.run_architecture_benchmark
```

It runs the typed-graph scorer, the RCG-35 single-agent LLM baseline, and the
RCG-36 free-text multi-agent baseline, then writes a timestamped report folder
under `benchmark/runs/` with:

- `typed-report.json`
- `single-agent-report.json`
- `free-text-report.json`
- `comparison.json`
- `manifest.json`

`benchmark/runs/` is intentionally ignored by Git because it can contain paid
LLM responses and large transcripts. For quick smoke checks, add `--limit 2`;
do not use a limited run for the final demo numbers.

The runner uses the same live LLM knobs as the individual baselines. Set
`SINGLE_AGENT_BASELINE_API_KEY` and `FREE_TEXT_MULTIAGENT_BASELINE_API_KEY`
when the two baselines should use different provider keys; otherwise both fall
back to `OPENAI_API_KEY`.

Use the lower-level comparison builder only when you already have three report
files:

```bash
python -m benchmark.architecture_comparison \
  --typed-report typed-report.json \
  --single-agent-report single-agent-report.json \
  --free-text-report free-text-report.json \
  --pretty
```

The comparison requires one report for each architecture:
`typed_graph_fixture`, `single_agent_llm_baseline`, and
`free_text_multiagent_baseline`. It verifies that all reports use the same
benchmark, fixture, and ordered case list, then emits an architecture summary
plus a case-by-case matrix for accuracy, hallucination count, and invalidation
correctness.

## Graph-Lane Invalidation Evidence

RCG-52 adds a read-only graph instrumentation helper for the cross-architecture eval harness:

```python
from benchmark.graph_instrumentation import collect_graph_eval_metrics

metrics = collect_graph_eval_metrics(
    connection,
    user_id=user_id,
    source_plan_id=stale_or_superseded_plan_id,
)
```

It returns an `evaluations`-ready payload with `plan_invalidation_correct`, `token_cost_total`, `metric_scores`, and `evaluator_version`. The helper scores only structural evidence from canonical tables: `plans`, `plan_steps`, `state_dependencies`, `graph_mutations`, `replan_jobs`, and `agent_runs`. Baseline plans intentionally receive no structural invalidation credit.
