# Person C Benchmark

This folder holds the seeded Person C benchmark artifacts.

## Run The Current Scorer

```bash
python -m benchmark.person_c_scorer --pretty
```

The scorer runs the fixture-backed typed path against `benchmark/gold/person-c-mvp-cases.json` and reports:

- accuracy
- strict hallucination count and rate
- invalidation correctness

The current scorer covers the typed-graph fixture path only. Single-agent and CrewAI-style baseline runners should reuse the same gold cases and report shape.

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
