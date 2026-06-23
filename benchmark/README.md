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
