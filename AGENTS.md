# Agent Instructions — Rewards Agent (gpFree)

Entry point for AI coding agents working in this repository.

---

## Before implementing anything

Read these files **in order**:

### Project context (`context/`)

1. [`context/project-overview.md`](context/project-overview.md) — what, who, flows, scope
2. [`context/architecture-context.md`](context/architecture-context.md) — boundaries, storage, invariants, complex patterns
3. [`context/design-context.md`](context/design-context.md) — UI/API contracts, mutation-log event shape
4. [`context/code-standards.md`](context/code-standards.md) — implementation rules
5. [`context/ai-workflow-rules.md`](context/ai-workflow-rules.md) — workflow and scoping
6. [`context/decisions-log.md`](context/decisions-log.md) — master index of decisions (links to ADRs)
7. [`context/risks-and-failure-modes.md`](context/risks-and-failure-modes.md) — what could go wrong
8. [`context/progress-tracker.md`](context/progress-tracker.md) — current phase and active work
9. Active feature spec in [`context/feature-specs/`](context/feature-specs/) — if one exists for this task

### Repo-specific (authoritative for this sprint)

10. [`README.md`](README.md) — project summary, team lanes, hard constraint
11. [`STATUS.md`](STATUS.md) — daily standup board, gates, blockers
12. [`docs/architecture/schema-final.md`](docs/architecture/schema-final.md) — **locked schema v3.1** (canonical; supersedes `schema-v2.md`)
13. [`schema/schema.sql`](schema/schema.sql) — canonical DDL
14. [`.coderabbit.yaml`](.coderabbit.yaml) — AI code review configuration
15. [`docs/adr/`](docs/adr/) — formal ADRs (0001 schema lock, 0002 research apparatus, 0003 team ownership)

---

## Merging to `main`

Pull requests targeting `main` require a passing **CodeRabbit** commit status check only — automatic review via [`.coderabbit.yaml`](.coderabbit.yaml) on each PR (`auto_review` on `main`; `fail_commit_status: true` if review is skipped).

CodeRabbit posts review comments and may request changes when it finds issues. Manual review trigger: `@coderabbitai review`.

Repository ruleset: **main — CodeRabbit** ([Settings → Rules](https://github.com/RCG5-26/rewards-typed-graph/rules/17850632)).

---

## While working

- Implement against `context/` files, feature specs, and locked schema — **do not invent product behavior**.
- Respect invariants in `context/architecture-context.md` and `docs/architecture/schema-final.md`.
- **Hard constraint:** coordination is typed graph mutations only — no free-text inter-agent messages.
- Schema is additive-only after lock; breaking changes need a new ADR + lead sign-off.
- Keep changes scoped to the active feature unit / lane.
- If you change architecture, scope, or standards → update the relevant `context/` file **before continuing**.

---

## After meaningful changes

Update [`context/progress-tracker.md`](context/progress-tracker.md):

- Current phase / goal if shifted
- Completed items
- In progress / next up
- New open questions

Log decisions in [`context/decisions-log.md`](context/decisions-log.md) (index row first). For durable architectural choices, add or update an ADR in [`docs/adr/`](docs/adr/) and link it from the index — do not paste full ADR text into the log.

For daily team visibility, update your row in [`STATUS.md`](STATUS.md) and your file in [`tracking/`](tracking/).

---

## Stack notes

- **Graph / persistence:** PostgreSQL, table-per-type, OCC via integer `version`
- **Orchestrator:** TypeScript (expected)
- **Agents / eval:** Python (expected)
- **Shared types:** one canonical artifact from `schema/` — both stacks validate against it
- **Layer 4 (ingestion + verifier):** stretch only; cut-by-default per ADR 0003

---

## Context folder map

See [`context/README.md`](context/README.md) for the full index and kickoff checklist.
