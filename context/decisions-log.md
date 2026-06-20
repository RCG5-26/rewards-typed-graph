# Decisions Log — [Project Name]

> Lightweight record of decisions that are expensive to reverse. For formal ADRs, use `docs/adr/` and link from here.

**Rule:** one row per real decision. Proposed items stay open until ratified.

---

## Index

| ID | Date | Decision | Status | Detail |
|---|---|---|---|---|
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
