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

| ADR                                                                       | Title                                               | Status   | D-refs                 |
| ------------------------------------------------------------------------- | --------------------------------------------------- | -------- | ---------------------- |
| [0001 — Schema Lock](0001-schema-lock.md)                                 | Table-per-type lock; v3.1 closeout ratified         | Accepted | D027                   |
| [0002 — Keep the Research Apparatus](0002-mvp-scope-trim.md)              | Benchmark + baselines retained                      | Accepted | D007                   |
| [0003 — Team is Four; Layer 4 Cut](0003-team-four-eval-ownership.md)      | Ownership map; Layer 4 cut-by-default               | Accepted | —                      |
| [0004 — Runtime Topology](0004-runtime-topology.md)                       | Compose local; managed PG hosted; eval not deployed | Accepted | D013, D023             |
| [0005 — Plan Lineage + Replan Jobs](0005-plan-lineage-replan-jobs.md)     | Revision model; leases; atomic promotion            | Accepted | D011, D012, D019–D021  |
| [0006 — Clerk Identity-Only](0006-clerk-identity-only.md)                 | Auth scope; per-user reset                          | Accepted | D006, D016             |
| [0007 — Contract Ownership + Codegen](0007-contract-ownership-codegen.md) | JSON Schema authoritative; subprocess contract      | Accepted | D009, D015, D026       |
| [0008 — Per-User Serialization + SSE](0008-per-user-serialization-sse.md) | Advisory lock; user-scoped mutation log             | Accepted | D004, D017, D024, D025 |
