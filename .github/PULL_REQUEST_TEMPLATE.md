<!-- Keep PRs scoped to one feature unit / lane. CodeRabbit reviews automatically; address its comments before merge. -->

## What & why

<!-- One or two lines. -->

- **Spec:** `context/feature-specs/NN-*.md`
- **Linear:** RCG-NN

## TDD attestation (test-first)

<!-- TDD is the team standard: context/code-standards.md → Testing (ADR 0009). -->

- [ ] Tests were written **before** the implementation (red → green → refactor)
- [ ] **Red phase recorded:** <!-- how the failing run was observed, e.g. "ran `npm run test:coverage` → new test failed before the change" -->
- [ ] All suites pass: `npm run test:coverage`, `cd apps/api && npm run test:coverage`, `npm run test:py`
- [ ] New/changed code is covered (CI enforces ≥90% diff coverage); coverage floors not lowered to pass

## Checklist

- [ ] Scoped to one feature unit / lane — only the files the spec lists
- [ ] **Code only** — no `STATUS.md` or `context/progress-tracker.md` (daily status → your [`tracking/<lane>.md`](../tracking/); lead syncs the board)
- [ ] Honors the locked schema ([`schema-final.md` v3.1](../docs/architecture/schema-final.md)); additive-only (no renames/removals/retypes without an ADR)
- [ ] **Hard constraint:** typed graph mutations only — no free-text inter-agent messages
- [ ] Typecheck passes; docs synced if behavior / scope / decisions changed — spec status; lead updates `progress-tracker.md` when the spec lands; ADR + `decisions-log.md` row if architectural
- [ ] No secrets / `.env` committed
