# AI & Development Workflow — [Project Name]

> How to build incrementally with humans and AI agents. Context files define *what*; this file defines *how we work*.

---

## Approach

- **Spec-driven:** implement against `context/` files and `feature-specs/` — do not invent product behavior.
- **Incremental:** small, verifiable steps over large speculative changes.
- **Docs follow code:** when implementation changes architecture, scope, or rules, update context *before* moving on.

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

1. Copy [`feature-specs/_template.md`](feature-specs/_template.md) → `feature-specs/NN-short-name.md`
2. Fill goal, scope, acceptance criteria, and touch list
3. Implement against the spec
4. Mark complete in [`progress-tracker.md`](progress-tracker.md)
5. Archive or leave spec in place for reference

---

## Handling missing requirements

- Do not invent product behavior.
- Add an **Open question** to `progress-tracker.md` or a **Decision (proposed)** to `decisions-log.md`.
- Resolve before implementing ambiguous paths.

---

## Keeping docs in sync

Update the relevant file when you change:

| Change type | Update |
|---|---|
| Product scope or flows | `project-overview.md` |
| Boundaries, storage, invariants | `architecture-context.md` |
| UI tokens, API contracts | `design-context.md` |
| Conventions | `code-standards.md` |
| Architectural choice | Row in [`decisions-log.md`](decisions-log.md); new [`docs/adr/`](../docs/adr/) file if expensive to reverse |
| Phase / completion | `progress-tracker.md` |
| New failure mode discovered | `risks-and-failure-modes.md` |

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
