<!-- Keep PRs scoped to one feature unit / lane. CodeRabbit reviews automatically; address its comments before merge. -->

## What & why

<!-- One or two lines. -->

- **Spec:** `context/feature-specs/NN-*.md`
- **Linear:** RCG-NN

## Checklist

- [ ] Scoped to one feature unit / lane — only the files the spec lists
- [ ] **Code only** — no `STATUS.md` or `context/progress-tracker.md` (daily status → your [`tracking/<lane>.md`](../tracking/); lead syncs the board)
- [ ] Honors the locked schema ([`schema-final.md` v3.1](../docs/architecture/schema-final.md)); additive-only (no renames/removals/retypes without an ADR)
- [ ] **Hard constraint:** typed graph mutations only — no free-text inter-agent messages
- [ ] Tests + typecheck pass
- [ ] Docs synced if behavior / scope / decisions changed — spec status; lead updates `progress-tracker.md` when the spec lands; ADR + `decisions-log.md` row if architectural
- [ ] No secrets / `.env` committed
