# Risks & Failure Modes — [Project Name]

> What could go wrong, how we'd notice, and what we do about it. Review at kickoff and before major gates.

**Last updated:** [YYYY-MM-DD]

---

## Risk register

| ID | Risk | Likelihood | Impact | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| R1 | [e.g. Critical path person blocked] | H/M/L | H/M/L | [plan] | [Name] | watching / mitigated |
| R2 | [e.g. Weak baseline invalidates comparison] | | | | | |
| R3 | [e.g. Schema drift mid-sprint] | | | | | |

---

## Failure modes by area

### [Area, e.g. Data / persistence]

| Failure | Symptom | Root cause | Prevention | Recovery |
|---|---|---|---|---|
| [e.g. Stale plan not invalidated] | UI shows fresh plan after state change | Staleness not triggered on write path | Single graph-write chokepoint | [manual re-plan / fix + backfill] |
| [e.g. Orphan dependency edges] | Verifier accepts bad reference | Polymorphic FK, no DB constraint | App-level integrity check | Orphan sweep job |

### [Area, e.g. Auth / security]

| Failure | Symptom | Prevention | Recovery |
|---|---|---|---|
| [e.g. IDOR on resource] | User A sees User B's data | Ownership check on every mutation | Revoke session, audit log |

### [Area, e.g. Integrations / external APIs]

| Failure | Symptom | Prevention | Recovery |
|---|---|---|---|
| [e.g. Tool timeout] | Agent hangs | Timeouts + circuit breaker | Fallback fixture |

### [Area, e.g. Demo / UX]

| Failure | Symptom | Prevention | Recovery |
|---|---|---|---|
| [e.g. Backend stream down] | Empty sidebar | Mock events from Day 1 | Swap to mocks live |

---

## Architectural claim risks

_If the project has a thesis (e.g. "typed coordination beats free text"), what would falsify it?_

| Claim | How it could silently fail | How we'd detect | Demo/benchmark signal |
|---|---|---|---|
| [Claim 1] | [failure mode] | [test/metric/UI] | [what good looks like] |
| [Claim 2] | | | |

---

## Schedule / scope risks

| Risk | Trigger | Release valve (what to cut first) |
|---|---|---|
| [e.g. Day 7 gate slips] | Integration not E2E | [Cut scope X, not Y] |
| [e.g. Overloaded lane] | One person on critical path | [Reassign Z per decisions-log] |

---

## Known edge cases (accepted for MVP)

Things we **know** are wrong or incomplete but **accept** for now. Prevents re-debating.

- [Edge case + why it's OK for MVP]
- [Edge case + when we'll fix it]

---

## Related

- Decisions: [`decisions-log.md`](decisions-log.md)
- Architecture invariants: [`architecture-context.md`](architecture-context.md)
