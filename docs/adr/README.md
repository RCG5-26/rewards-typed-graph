# Architecture Decision Records

Lightweight log of decisions that are expensive to reverse. One file per decision, numbered, append-only. This is how the team keeps a durable record without heavyweight process.

## Why this exists
The schema is frozen after the Day 1 lock. "Frozen" only means something if changes are visible and deliberate. After the lock, **any schema change goes through Raq (owner/lead), is evaluated against existing `DEPENDS_ON_STATE` edges first, and is recorded as a new ADR.** No silent migrations.

## How to add one
1. Copy the format of `0001-schema-lock.md`.
2. Increment the number (`0002-…`, `0003-…`). Use a short kebab-case title.
3. Status starts `Proposed`; flip to `Accepted` (with date + who signed off) once agreed. Use `Superseded by 000N` if a later ADR replaces it.
4. Open a PR. Keep it short: Context, Decision, Consequences.

## Index
- [0001 — Schema Lock (v2)](0001-schema-lock.md) — the typed-graph schema, OCC model, and the resolutions from the v2 review. Status: Partially superseded for MVP storage by ADR 0004; plan lifecycle remains authoritative.
- [0002 — MVP Scope: Keep the Research Apparatus](0002-mvp-scope-trim.md) — decision to retain the benchmark, both baselines, and the eval harness. No schema change; the cost is Person C's load, with a protection plan. Status: Accepted.
- [0003 — Team is Four; Eval Harness & Layer 4 Ownership](0003-team-four-eval-ownership.md) — Ruijing out; four-person ownership map; eval harness = whole-team contribution + Raq DRI; Layer 4 cut-by-default. Status: Accepted.
- [0004 — MVP Storage Uses Polymorphic Nodes and Edges](0004-mvp-polymorphic-graph-schema.md) — changes the v3/v3.1 physical table layout in favor of the `nodes`/`edges` JSONB schema while preserving v3.1 plan lineage/revision semantics. Status: Proposed (requires all-four lane sign-off).
