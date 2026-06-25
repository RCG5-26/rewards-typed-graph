# AI & Development Workflow — [Project Name]

> How to build incrementally with humans and AI agents. Context files define _what_; this file defines _how we work_.

---

## Approach

- **Spec-driven:** implement against `context/` files and `feature-specs/` — do not invent product behavior.
- **Incremental:** small, verifiable steps over large speculative changes.
- **Test-first (TDD):** every change is test-driven — write a failing test first, then the code to pass it. This is repo-wide, not just spec work; specs that name tests are the concrete instance. Canonical policy: [`code-standards.md`](code-standards.md) → Testing (CI enforces all suites + diff coverage; the PR red-phase attestation enforces ordering).
- **Docs follow code:** when implementation changes architecture, scope, or rules, update context _before_ moving on.

---

## Read order (agents & new contributors)

1. [`project-overview.md`](project-overview.md) — product, users, flows, scope
2. [`architecture-context.md`](architecture-context.md) — structure, boundaries, invariants
3. [`design-context.md`](design-context.md) — UI/API contracts _(skip if N/A)_
4. [`code-standards.md`](code-standards.md) — implementation rules
5. [`decisions-log.md`](decisions-log.md) — master index of decisions (links to ADRs + architecture)
6. [`risks-and-failure-modes.md`](risks-and-failure-modes.md) — what to watch
7. [`progress-tracker.md`](progress-tracker.md) — current state
8. Relevant [`feature-specs/NN-*.md`](feature-specs/) — active unit of work

---

## Scoping rules

- One feature unit or subsystem at a time.
- Do not combine unrelated boundaries in a single step (see "When to split" below).
- If behavior is undefined, **stop and update context** — do not guess.

---

## When to split work

Split an implementation step if it combines:

- UI changes and background/async job changes
- Multiple unrelated API routes or services
- Schema migration + unrelated feature logic
- Behavior not defined in context or an active feature spec

If the change cannot be verified end-to-end quickly, the scope is too broad.

---

## Feature spec workflow

1. Copy [`feature-specs/_template.md`](feature-specs/_template.md) → `feature-specs/NN-short-name.md` and add a row to [`feature-specs/README.md`](feature-specs/README.md).
2. Fill it and clear the **Definition of ready** gate: goal, testable acceptance criteria, linked contracts, touch list, dependencies + Linear id. A spec is not implementable until every gate box is checked.
3. Lead confirms the spec is **Ready**.
4. Run the **implement prompt** (below). It marks the spec `In progress`, implements only what's specified, tests, then marks it `Done`.
5. Confirm `Done`, fill the spec's Completion notes, and add a line to [`progress-tracker.md`](progress-tracker.md) "Recently completed."

---

## Implement prompt (copy-paste)

One spec at a time. Replace `NN-<name>`.

```text
Read context/feature-specs/NN-<name>.md and AGENTS.md.
Mark this unit In Progress in the spec header and in context/progress-tracker.md.
Implement only what the spec's Acceptance Criteria require; change only the files the spec lists.
Honor docs/architecture/schema-final.md and the invariants in context/architecture-context.md.
Hard constraint: coordination is typed graph mutations only — no free-text inter-agent messages. Schema is additive-only.
Write the tests named in the spec first, then code until they pass. Run typecheck + tests.
When green: set the spec status to Done, fill Completion notes, add one line to progress-tracker "Recently completed" (files touched + any gotcha), then STOP. Do not start the next spec.
```

If anything in the spec is ambiguous, stop and add an **Open question** — do not guess.

---

## Handling missing requirements

- Do not invent product behavior.
- Add an **Open question** to `progress-tracker.md` or a **Decision (proposed)** to `decisions-log.md`.
- Resolve before implementing ambiguous paths.

---

## Keeping docs in sync

**One source of truth per fact** — everything else links to it, never copies it:

| Fact | Lives in |
|---|---|
| Product scope / intent | `project-overview.md` |
| Data model + contracts | `../docs/architecture/schema-final.md` + `../schema/contracts/` |
| Architecture boundaries / invariants | `architecture-context.md` |
| Decisions (index + durable) | `decisions-log.md` + `../docs/adr/` |
| Tasks + status (system of record) | Linear (**RCG**) |
| What to build (a unit) | `feature-specs/NN-*.md` |
| Current narrative / AI memory | `progress-tracker.md` (+ `progress-archive.md`) |
| Daily lane status | Linear + `../tracking/<lane>.md` |
| Standup snapshot | `../STATUS.md` (lead syncs from tracking + Linear) |
| Backend local setup (operational) | `../docs/development/backend-local-setup.md` |

**Two rules:** (1) link, don't duplicate — a copy is a future contradiction; (2) on any conflict, the locked docs (`schema-final.md`, `../docs/adr/`) and Linear win over the narrative docs.

Update the relevant file when you change:

| Change type                     | Update                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Product scope or flows          | `project-overview.md`                                                                                       |
| Boundaries, storage, invariants | `architecture-context.md`                                                                                   |
| UI tokens, API contracts        | `design-context.md`                                                                                         |
| Conventions                     | `code-standards.md`                                                                                         |
| Architectural choice            | Row in [`decisions-log.md`](decisions-log.md); new [`docs/adr/`](../docs/adr/) file if expensive to reverse |
| Phase / completion              | `progress-tracker.md`                                                                                       |
| New failure mode discovered     | `risks-and-failure-modes.md`                                                                                |

`progress-tracker.md` must reflect **actual** state, not intended state.

---

## Before moving to the next unit

- [ ] Current unit works within its defined scope
- [ ] No invariant from `architecture-context.md` was violated
- [ ] `progress-tracker.md` updated
- [ ] New decisions logged if any were made during implementation

---

## Agent-specific notes _(optional)_

- [e.g. "Run `npm run build` after UI changes"]
- [e.g. "Never commit `.env`"]
- [Framework-specific agent rules — link or embed]
