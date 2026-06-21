# Decisions Log — [Project Name]

> Lightweight record of decisions that are expensive to reverse. For formal ADRs, use `docs/adr/` and link from here.

**Rule:** one row per real decision. Proposed items stay open until ratified.

---

## Index

| ID | Date | Decision | Status | Detail |
|---|---|---|---|---|
| D002 | 2026-06-21 | Preserve v3.1 plan lifecycle in MVP polymorphic storage | Proposed | ADR 0004 is storage-only; plan lineage/revision and supersede semantics remain canonical. |
| D001 | [YYYY-MM-DD] | [Short title] | Accepted / Proposed / Superseded | [Link or section below] |

---

## Template (copy for new entries)

### D00N — [Title]

- **Status:** Proposed | Accepted | Superseded by D00M
- **Date:** [YYYY-MM-DD]
- **Deciders:** [who signed off]
- **Context:** [Why we had to decide]
- **Decision:** [What we chose]
- **Alternatives considered:** [What we didn't pick and why]
- **Consequences:** [What follows — good and bad]

---

## Decisions

### D002 — Preserve v3.1 plan lifecycle in MVP polymorphic storage

- **Status:** Proposed
- **Date:** 2026-06-21
- **Deciders:** Alan, pending all-lane ADR 0004 sign-off
- **Context:** PR #2 uses polymorphic `nodes` / `edges`, but review feedback flagged that in-place plan refresh conflicts with v3.1 lineage/revision semantics and the hero invalidation chain.
- **Decision:** Keep polymorphic storage as the proposed MVP physical layout, but preserve v3.1 plan lifecycle: plan nodes carry `plan_lineage_id` and `revision_number`; successful re-plans create successor revisions; prior stale steps become `superseded` only after the successor exists.
- **Alternatives considered:** Treat ADR 0004 as superseding all v3.1 plan lifecycle behavior. Rejected because it breaks auditability, failed re-plan handling, and the demo sidebar invalidation chain.
- **Consequences:** Re-plan code must call `supersede_plan_step` instead of updating stale steps in place. Failed successor creation leaves the source step `stale`.

### D001 — [Example: Primary database]

- **Status:** [Proposed | Accepted]
- **Date:** [YYYY-MM-DD]
- **Deciders:** [Names]
- **Context:** [Need persistent relational data with …]
- **Decision:** [PostgreSQL via …]
- **Alternatives considered:** [SQLite (too limited), Mongo (wrong shape)]
- **Consequences:** [Migrations via …; hosted on …]

---

_Add new decisions above this line, newest first._

---

## Formal ADRs _(if repo uses them)_

| ADR | Title | Status |
|---|---|---|
| [0001](docs/adr/0001-example.md) | [Title] | [Proposed / Accepted] |

_Point to repo ADR folder; don't duplicate full ADR text here._
