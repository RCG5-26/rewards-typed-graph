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
- [0001 — Schema Lock (v2)](0001-schema-lock.md) — the typed-graph schema, OCC model, and the resolutions from the v2 review. Status: Proposed (ratify at Day 1 meeting).
