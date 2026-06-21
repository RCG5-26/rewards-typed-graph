# Architecture Decision Records

Formal, PR-reviewed decisions that are expensive to reverse. One file per decision, numbered, append-only.

**Master index:** [`context/decisions-log.md`](../../context/decisions-log.md) — all D-series and ADR entries in one place. Do not duplicate ADR bodies in the decisions log.

## Why ADRs exist

The schema is additive-only after lock. "Locked" only means something if changes are visible and deliberate. After lock, **any schema or architecture change that is hard to reverse goes through Raq (owner/lead), is evaluated against existing dependencies first, and is recorded as a new ADR** (and indexed in `decisions-log.md`).

## How to add one

1. Add a row to [`context/decisions-log.md`](../../context/decisions-log.md) (status **Proposed**).
2. Copy the format of `0001-schema-lock.md`.
3. Increment the number (`0009-…`). Use a short kebab-case title.
4. Flip to **Accepted** (with date + who signed off) in both the ADR and the index.
5. Use `Superseded by 000N` if a later ADR replaces it.

## Index
- [0001 — Schema Lock (v2)](0001-schema-lock.md) — the typed-graph schema, OCC model, and the resolutions from the v2 review. Status: Accepted; v3.1 table-per-type storage remains authoritative.
- [0002 — MVP Scope: Keep the Research Apparatus](0002-mvp-scope-trim.md) — decision to retain the benchmark, both baselines, and the eval harness. No schema change; the cost is Person C's load, with a protection plan. Status: Accepted.
- [0003 — Team is Four; Eval Harness & Layer 4 Ownership](0003-team-four-eval-ownership.md) — Ruijing out; four-person ownership map; eval harness = whole-team contribution + Raq DRI; Layer 4 cut-by-default. Status: Accepted.
- [0004 — Proposed MVP Polymorphic Storage](0004-mvp-polymorphic-graph-schema.md) — superseded proposal; polymorphic `nodes`/`edges` storage is preserved only under `schema/experimental/polymorphic/`. Canonical storage remains v3.1 table-per-type.
