<!-- Keep PRs scoped to one feature unit / lane. CodeRabbit reviews automatically; address its comments before merge. -->

## What & why

<!-- One or two lines. -->

- **Spec:** `context/feature-specs/NN-*.md`
- **Linear:** RCG-NN

## Checklist

- [ ] Scoped to one feature unit / lane — only the files the spec lists
- [ ] Honors the locked schema ([`schema-final.md` v3.1](../docs/architecture/schema-final.md)); additive-only (no renames/removals/retypes without an ADR)
- [ ] **Hard constraint:** typed graph mutations only — no free-text inter-agent messages
- [ ] Tests + typecheck pass
- [ ] Docs synced if behavior / scope / decisions changed — spec status, `context/progress-tracker.md`, and an ADR + `decisions-log.md` row if it was an architectural choice
- [ ] No secrets / `.env` committed
