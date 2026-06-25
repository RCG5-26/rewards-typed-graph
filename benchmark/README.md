# Person C Benchmark

This folder holds the seeded Person C benchmark artifacts. The gold corpus has
30 executable queries: 10 earning, 10 redemption, and 10 portfolio cases.

## Run The Current Scorer

```bash
python -m benchmark.person_c_scorer --pretty
```

The gold file's `scoring_rules.expected_axis_counts` records the **required case count per `benchmark_axis`** (10 earning, 10 redemption, 10 portfolio). Tests assert the corpus matches those totals exactly — they are not sampling weights.

The scorer runs the fixture-backed typed path against `benchmark/gold/person-c-mvp-cases.json` and reports:

- accuracy
- strict hallucination count and rate
- invalidation correctness
- benchmark-axis and category counts

The current scorer covers the typed-graph fixture path only. Single-agent and CrewAI-style baseline runners should reuse the same gold cases and report shape.

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

The runner makes one JSON-only LLM call per benchmark case. It supplies the same seeded fixture/tool facts as context, but the output is treated as a baseline sink only: `plan_type = baseline_single_agent`, final raw output, no `plan_steps`, no `state_dependencies`, and no graph-mutation coordination. Invalidation cases therefore receive no structural invalidation credit by design.

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
