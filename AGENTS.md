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
8. [`context/progress-tracker.md`](context/progress-tracker.md) — **AI working memory**: read first for current state + recent history (older history in [`context/progress-archive.md`](context/progress-archive.md))
9. Active feature spec in [`context/feature-specs/`](context/feature-specs/) — if one exists for this task

### Repo-specific (authoritative for this sprint)

10. [`README.md`](README.md) — project summary, team lanes, hard constraint
11. [`STATUS.md`](STATUS.md) — weekly standup snapshot, gates, blockers (lead-maintained; sync from `tracking/` + Linear)
12. [`docs/architecture/schema-final.md`](docs/architecture/schema-final.md) — **locked schema v3.1** (canonical; supersedes `schema-v2.md`)
13. [`schema/schema.sql`](schema/schema.sql) — canonical DDL
14. [`.coderabbit.yaml`](.coderabbit.yaml) — AI code review configuration
15. [`docs/adr/`](docs/adr/) — formal ADRs (0001 schema lock, 0002 research apparatus, 0003 team ownership)

---

## Merging to `main`

Pull requests targeting `main` must pass these required status checks:

- **CodeRabbit** — automatic review via [`.coderabbit.yaml`](.coderabbit.yaml) (`auto_review` on `main`; `fail_commit_status: true` if review is skipped). It posts comments and may request changes; manual trigger: `@coderabbitai review`.
- **Schema apply** — `apply-schema` job ([`.github/workflows/schema-postgres.yml`](.github/workflows/schema-postgres.yml)).
- **Tests + coverage (TDD)** — `web-vitest`, `api-vitest`, `python-tests`, and `coverage-gate` jobs ([`.github/workflows/tests.yml`](.github/workflows/tests.yml)). See [`docs/development/ci-required-checks.md`](docs/development/ci-required-checks.md) for the exact check names and how they are wired into the ruleset.

Plus **1 human approval** before merge.

Repository ruleset: **main — protected** ([Settings → Rules](https://github.com/RCG5-26/rewards-typed-graph/rules/17850632)).

---

## While working

- Implement against `context/` files, feature specs, and locked schema — **do not invent product behavior**.
- Respect invariants in `context/architecture-context.md` and `docs/architecture/schema-final.md`.
- **Hard constraint:** coordination is typed graph mutations only — no free-text inter-agent messages.
- Schema is additive-only after lock; breaking changes need a new ADR + lead sign-off.
- Keep changes scoped to the active feature unit / lane.
- If you change architecture, scope, or standards → update the relevant `context/` file **before continuing**.

---

## Team status & visibility

**Do not bundle standup updates into feature PRs.** Code PRs stay code-only.

| Artifact | Who | When | Purpose |
|---|---|---|---|
| **Linear** (RCG-##) | Each person | Daily | Live task board |
| [`tracking/<lane>.md`](tracking/) | Each person | Daily | Lane status in-repo; **tiny PR, merge same day** |
| [`STATUS.md`](STATUS.md) | Lead (Raq) | Before standup / gates | Weekly snapshot — standup grid synced from `tracking/` + Linear |
| [`context/progress-tracker.md`](context/progress-tracker.md) | Lead (Raq) | When a spec or PR lands | Milestone narrative for agents and integration |

**Daily (each person):** update your `tracking/<lane>.md` + Linear tickets.  
**Standup (lead):** sync `STATUS.md` from `tracking/` + Linear.  
**Milestones (lead):** update `progress-tracker.md` when a spec merges.  
**Feature PRs:** code only — no `STATUS.md`, no `progress-tracker.md`.

Implementation agents: **`STATUS.md` and `tracking/` are excluded** from automated implementation touch lists (see active feature spec). Humans maintain them in the standup flow.

## Before you finish (quality gates)

Run these on every meaningful change before handing off or opening a PR:

1. **Tests (TDD)** — write tests first, then code (red → green → refactor). Run all suites with coverage: `npm run test:coverage`, `cd apps/api && npm run test:coverage`, `npm run test:py`. New/changed code must be covered (CI enforces ≥90% diff coverage). Canonical policy: [`context/code-standards.md`](context/code-standards.md) → Testing ([ADR 0009](docs/adr/0009-tdd-enforcement.md)).
2. **Format** — `npm run format` (Prettier). Verify with `npm run format:check`; keep the diff formatting-clean. Config: [`.prettierrc.json`](.prettierrc.json) / [`.prettierignore`](.prettierignore).
3. **Lint** — `npm run lint` (ESLint via `next lint`). Resolve any warnings you introduced.
4. **Simplify** — do a simplification pass (reuse, dead code, right altitude) and apply the safe cleanups. Run the `/simplify` review on the diff.
5. **Security review** — run `/security-review` on the branch diff. Check auth boundaries (Clerk identity-only, per [`docs/adr/0006-clerk-identity-only.md`](docs/adr/0006-clerk-identity-only.md)), per-user data scoping, input handling, and secrets. Never commit secrets or `.env*` files — only [`.env.example`](.env.example).

---

## After meaningful changes

Update [`context/progress-tracker.md`](context/progress-tracker.md) **when a spec or PR lands** (lead, or implementer if the spec explicitly requires it):

- Current phase / goal if shifted
- Completed items
- In progress / next up
- New open questions

Keep the tracker lean — current state + recent history only; move older entries to [`context/progress-archive.md`](context/progress-archive.md). On any conflict, the locked docs (`docs/architecture/schema-final.md`, `docs/adr/`) and Linear take precedence over the tracker.

Log decisions in [`context/decisions-log.md`](context/decisions-log.md) (index row first). For durable architectural choices, add or update an ADR in [`docs/adr/`](docs/adr/) and link it from the index — do not paste full ADR text into the log.

**Daily lane status:** update your file in [`tracking/`](tracking/) (tiny PR). Do **not** edit `STATUS.md` in feature PRs — the lead syncs the standup grid before standup.

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
