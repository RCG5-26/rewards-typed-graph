# 0009 — Test-Driven Development enforced repo-wide

- **Status:** Accepted — June 25, 2026.

## Context

TDD existed only as a per-spec convention (e.g. `context/feature-specs/05-orchestrator-harness.md` required a recorded red phase in `AI_USAGE.md`). At the repo level there was no requirement:

- CI (`.github/workflows/schema-postgres.yml`) ran only the schema apply plus two live-Postgres Python tests. It did not run the full Python suite, either Vitest suite, or any coverage.
- No coverage tooling existed in any stack.
- `context/code-standards.md` → Testing was an unfilled template.
- The `main` merge gate was effectively CodeRabbit-only.

Tests do exist across three runners (root Vitest for web, `apps/api` Vitest for the orchestrator/agents, Python `unittest`), but nothing made them run or block merges.

## Decision

Adopt a **two-layer enforcement model** for TDD across the whole repo.

**Mechanical layer (CI, blocking):**

- A `tests.yml` workflow runs all three suites on every PR; any failure blocks merge.
- A `coverage-gate` job runs `diff-cover` over the combined coverage reports (web lcov + api lcov + Python Cobertura XML) and fails when **changed lines** fall below the diff-coverage threshold. This is the primary "new code must be tested" enforcer.
- Each stack carries a **ratchet baseline** (Vitest `coverage.thresholds`, coverage.py `fail_under`) seeded just under current measured coverage so total coverage cannot regress.
- These checks become required status checks on the `main` ruleset (see `docs/development/ci-required-checks.md`).

**Attestation layer (process, review):**

- A PR template carries a red-phase / test-first checklist.
- CodeRabbit `path_instructions` flag code changes that lack matching test changes and an unchecked attestation.

## Consequences

- **Honest limitation:** CI can prove tests exist, pass, and cover changed lines. It **cannot** prove a test was written _before_ the code. Test-first ordering is enforced socially (attestation + review), not mechanically.
- A low global coverage floor (web is ~6% aggregate because untested React UI is in scope) is **not** a loophole: the diff-coverage gate enforces coverage on every changed line regardless of file.
- Python keeps stdlib `unittest`; `coverage.py` wraps it without a pytest migration.
- Live-Postgres integration tests remain enforced by `schema-postgres.yml`; the `tests.yml` Python job runs the non-live unit suite for speed and reliability.
- Scope is **this repo only** — not org-wide GitHub rulesets across repositories.

Canonical policy lives in `context/code-standards.md` (Testing). Everything else links to it.
