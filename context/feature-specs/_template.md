# [NN] — [Feature / subsystem name]

- **Status:** Proposed | In progress | Done
- **Owner:** [Name]
- **Depends on:** [other specs, decisions, or "none"]
- **Related flows:** [link to flow in project-overview.md, e.g. "Flow 1: Happy path"]

---

## Goal

[One paragraph. What this unit delivers and why it exists now.]

---

## User-visible behavior

[What the user (or downstream system) sees when this is done. Bullet points OK.]

- [Behavior 1]
- [Behavior 2]

---

## Out of scope

Explicit boundaries for *this* spec only.

- [Not doing X]
- [Not doing Y — belongs in spec NN+1]

---

## Design notes _(optional)_

[UI mock description, API shape sketch, link to design-context.md section]

---

## Implementation plan

Numbered steps. Keep each step verifiable.

1. [Step]
2. [Step]
3. [Step]

---

## Files / modules (expected touch list)

| Path | Change |
|---|---|
| `[path]` | [create / modify — what] |
| `[path]` | [modify — what] |

_Agent: do not touch files outside this list unless the spec is updated first._

---

## Data & schema _(if applicable)_

- **Tables / models:** [names]
- **Migrations:** [yes/no, notes]
- **Seed data:** [required fixtures]

---

## API / events _(if applicable)_

### [Endpoint or event name]

- **Method / trigger:** [GET / POST / webhook / job]
- **Auth:** [required role / ownership check]
- **Request:** [shape or "see types in …"]
- **Response:** [shape]
- **Errors:** [401, 403, 404, …]

---

## Acceptance criteria

- [ ] [Testable criterion 1]
- [ ] [Testable criterion 2]
- [ ] [Testable criterion 3]
- [ ] `[build/test command]` passes
- [ ] No invariant from `architecture-context.md` violated

---

## Verification

How to manually or automatically verify this spec is done.

```bash
# commands to run
[command]
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
