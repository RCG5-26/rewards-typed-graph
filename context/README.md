# Project Context

Reusable context templates for any software project. Fill these in at project kickoff and keep them current as the system evolves.

**Purpose:** give humans and AI agents a shared, authoritative picture of the product — without re-explaining the project every session.

---

## What each file answers

| File | Questions it answers |
|---|---|
| [`project-overview.md`](project-overview.md) | What is this? Who is it for? What's in/out of scope? What does success look like? |
| [`architecture-context.md`](architecture-context.md) | How does it fit together? What are the boundaries, storage model, and invariants? |
| [`design-context.md`](design-context.md) | How should it look and feel? (UI projects) API/event contracts? (all projects) |
| [`code-standards.md`](code-standards.md) | What are the implementation rules and conventions? |
| [`ai-workflow-rules.md`](ai-workflow-rules.md) | How do we build incrementally? When to split work? How to keep docs in sync? |
| [`progress-tracker.md`](progress-tracker.md) | Where do things stand right now? What's done, in progress, next? |
| [`decisions-log.md`](decisions-log.md) | What did we decide, when, and why? |
| [`risks-and-failure-modes.md`](risks-and-failure-modes.md) | What could go wrong? What are we watching? |
| [`feature-specs/`](feature-specs/) | Per-unit implementation specs (one file per feature or subsystem) |
| [`AGENTS.md`](AGENTS.md) | Entry point for AI agents — read order and update rules |

---

## Kickoff checklist (new project)

1. Copy this entire `context/` folder into the project repo root.
2. Find-replace placeholders: `[Project Name]`, `[Owner]`, `[Repo URL]`.
3. Fill `project-overview.md` first — everything else references it.
4. Fill `architecture-context.md` before writing code.
5. Skim or skip `design-context.md` for backend-only / CLI projects.
6. Reset `progress-tracker.md` to your starting phase.
7. Add your first entry to `decisions-log.md` (stack choice, scope lock, etc.).
8. When you start a feature, copy `feature-specs/_template.md` → `feature-specs/NN-short-name.md`.

---

## Maintenance rules

- **Update after meaningful change** — not every commit, but every phase shift, scope change, or architectural decision.
- **One source of truth** — if README and context disagree, fix context (or README if context is authoritative for that topic).
- **Specs before code** — if behavior isn't defined, add it to a context file or feature spec before implementing.
- **Decisions get logged** — lightweight entries in `decisions-log.md`; formal ADRs in `docs/adr/` if the repo uses them.

---

## Optional extensions

| Need | Add |
|---|---|
| Formal ADRs | `docs/adr/` in repo + link from `decisions-log.md` |
| Team coordination | `STATUS.md` + `tracking/` (sprint repos) |
| Interview prep | Personal `STUDY_GUIDE.md` (gitignored, not in context/) |
