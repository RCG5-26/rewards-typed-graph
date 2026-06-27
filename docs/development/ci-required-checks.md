# CI Required Checks (main ruleset)

How the `main` branch protection is wired, and the exact status-check names to mark **Required** in the GitHub ruleset. Canonical TDD policy: [`context/code-standards.md`](../../context/code-standards.md) → Testing ([ADR 0009](../adr/0009-tdd-enforcement.md)).

## Required status checks

| Check name      | Source                                                               | Enforces                                                 |
| --------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| CodeRabbit      | [`.coderabbit.yaml`](../../.coderabbit.yaml)                         | Automated review; `fail_commit_status` blocks if skipped |
| `apply-schema`  | [`schema-postgres.yml`](../../.github/workflows/schema-postgres.yml) | Schema applies cleanly + live-Postgres tests             |
| `web-vitest`    | [`tests.yml`](../../.github/workflows/tests.yml)                     | Web Vitest suite passes + coverage floor                 |
| `api-vitest`    | [`tests.yml`](../../.github/workflows/tests.yml)                     | `apps/api` Vitest suite passes + coverage floor          |
| `python-tests`  | [`tests.yml`](../../.github/workflows/tests.yml)                     | Python `unittest` suite passes                           |
| `coverage-gate` | [`tests.yml`](../../.github/workflows/tests.yml)                     | ≥90% diff coverage on changed lines (web + api + python) |

Plus **1 human approval**.

> Check names equal the job `name:` values. `coverage-gate` only runs after the three suite jobs succeed (`needs:`), so requiring it transitively requires the suites — but mark all of them Required so a deleted/renamed job can't silently bypass the gate.

## Wiring it in GitHub (admin, one-time)

1. **Settings → Rules → Rulesets → "main — protected"** (or create a ruleset targeting `main`).
2. Enable **Require status checks to pass before merging**; add each check name above. They appear in the list only after the workflow has run at least once on a PR/commit — open one PR from this branch first so GitHub learns the names.
3. Enable **Require a pull request before merging** with **1 required approval**.
4. Keep **Require branches to be up to date** on if you want PRs rebased before merge.
5. Save.

## Rollout order (important)

`tests.yml` lands and runs on PRs **before** the checks are marked Required. This makes failures visible without blocking the team mid-flight. Once a green baseline is confirmed on a couple of PRs, flip the checks to Required in the ruleset.

## Thresholds (single source of truth)

These are the only places coverage numbers live. **Do not edit a config value without updating this table**, and never lower a floor to make a PR pass.

| Knob                          | Value                                             | Defined in                                                   | Meaning                                                       |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| Diff coverage (changed lines) | 90%                                               | `.github/workflows/tests.yml` → `coverage-gate` `fail-under` | The real "new code is tested" gate (all stacks)               |
| Web ratchet floor             | lines/statements 6%                               | `vitest.config.ts` → `coverage.thresholds`                   | Web total can't regress (low because untested UI is in scope) |
| API ratchet floor             | lines/statements 65%, functions 88%, branches 76% | `apps/api/vitest.config.ts` → `coverage.thresholds`          | API total can't regress                                       |
| Python ratchet floor          | 78%                                               | `.coveragerc` → `[report] fail_under`                        | Python total can't regress                                    |

**Rationale for the two-layer model (low floors + strict diff coverage): see [ADR 0009](../adr/0009-tdd-enforcement.md).** Raise floors as coverage improves.
