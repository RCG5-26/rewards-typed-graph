# [NN] — [Feature / subsystem name]

- **Status:** Draft | Ready | In progress | Done
- **Owner:** [Name] · **Lane:** [Graph/Persistence | Orchestrator/Agents | Redemption/Eval | Frontend/Demo]
- **Linear:** [RCG-NN, …]
- **Depends on:** [other specs / decisions / "none"]
- **Related flows:** [link to a flow in ../project-overview.md]

---

## Definition of ready (gate — do NOT run the implement prompt until all checked)

- [ ] Goal and out-of-scope are unambiguous
- [ ] Acceptance criteria are testable (no "works well")
- [ ] Contracts it consumes/produces are linked (not restated)
- [ ] Files/modules touch list is filled
- [ ] Dependencies + Linear id(s) recorded
- [ ] No open question is still `Blocking: yes`

---

## Goal

[One paragraph. What this unit delivers and why it exists now.]

---

## Contracts touched (link — do not restate the schema)

- **Consumes:** [e.g. `../../docs/architecture/schema-final.md` §… ; `schema/contracts/…`]
- **Produces:** [tables/rows/events this unit writes or emits]
- **Invariants that apply:** [link `../architecture-context.md` items]

---

## User-visible / downstream behavior

- [Behavior 1]
- [Behavior 2]

---

## Out of scope

- [Not doing X — belongs in spec NN]

---

## Implementation plan

Numbered, each step verifiable.

1. [Step]
2. [Step]

---

## Files / modules (expected touch list)

| Path | Change |
|---|---|
| `[path]` | [create / modify — what] |

_Agent: do not touch files outside this list unless the spec is updated first._

---

## Data & schema _(if applicable)_

- **Tables / models:** [names — link schema-final, don't redefine]
- **Migrations:** [yes/no]
- **Seed data:** [required fixtures]

---

## API / events _(if applicable)_

### [Endpoint or event name]

- **Trigger / method:** […]
- **Auth / ownership:** […]
- **Shape:** [link to `schema/contracts/…` or shared types]
- **Errors:** […]

---

## Acceptance criteria

- [ ] [Testable criterion 1]
- [ ] [Testable criterion 2]
- [ ] `[build/test command]` passes
- [ ] No invariant from `../architecture-context.md` violated
- [ ] Hard constraint respected: typed graph mutations only (no free-text inter-agent messages)

---

## Verification

```bash
[commands to run]
```

**Manual check:** [steps]

---

## Open questions

| # | Question | Blocking? | Resolution |
|---|---|---|---|
| 1 | [Question] | yes/no | [pending / link to decisions-log] |

---

## Completion notes _(fill when done)_

- **Completed:** [YYYY-MM-DD]
- **PR / commit:** [link or hash]
- **Deviations from spec:** [none / describe]
