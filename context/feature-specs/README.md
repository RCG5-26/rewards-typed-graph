# Feature Specs

One file per implementable unit — a feature, subsystem, or vertical slice. The spec is the build order; once it's **Ready**, an agent implements it with the prompt in [`../ai-workflow-rules.md`](../ai-workflow-rules.md#implement-prompt-copy-paste).

---

## Naming

```
NN-short-kebab-name.md
```

- `NN` = two-digit stable id (just an id, **not** build order — order lives in `Depends on` + the index below).
- `short-kebab-name` = what it does, not who owns it.

---

## Status lifecycle

`Draft` → `Ready` (passes the Definition of Ready gate in the template) → `In progress` → `Done`.

Only implement a spec that is **Ready**. The lead confirms "Ready" before the implement prompt is run.

---

## Workflow

1. Copy [`_template.md`](_template.md) → `NN-short-name.md`.
2. Fill it; clear the **Definition of ready** gate. Add a row to the table below.
3. When implementing: mark the spec `In progress` (header) and reflect it in [`../progress-tracker.md`](../progress-tracker.md).
4. When done: mark the spec `Done`, fill Completion notes, and add a line to the tracker's "Recently completed."

---

## Spec quality bar

A spec is **Ready** when another developer or agent could implement it without asking product questions. It must have: a clear goal + out of scope, testable acceptance criteria, the contracts it touches (linked, not restated), the files it may change, and its dependencies + Linear id(s).

**Do not:** combine unrelated units in one spec; duplicate `project-overview.md` / `schema-final.md` (link instead); leave acceptance criteria vague.

---

## Active specs

| ID  | Spec                                                       | Status | Owner      | Linear                | Depends on     |
| --- | ---------------------------------------------------------- | ------ | ---------- | --------------------- | -------------- |
| 01  | design-system _(planned)_                                  | Draft  | Val        | —                     | none           |
| 02  | [graph write path](02-graph-write-path.md)                 | Draft  | Alan       | RCG-10/11/13/14/58/59 | RCG-7, RCG-9   |
| 03  | [mutation log + SSE contract](03-mutation-log-sse.md)      | Draft  | Alan / Val | RCG-14, RCG-25        | 02             |
| 04  | [redemption traversal](04-redemption-traversal.md)         | Draft  | Michael    | RCG-20, RCG-21        | 02, RCG-22/23  |
| 05  | [orchestrator + agent harness](05-orchestrator-harness.md) | Draft  | Raq        | RCG-15                | 02 (interface) |
| 06  | [wallet + earning agents](06-wallet-and-earning-agents.md) | Draft  | Raq        | RCG-16, RCG-17        | 02, 05         |
| 07  | [API service (HTTP surface)](07-api-service.md)            | Ready  | Raq        | RCG-18                | 05, RCG-28/29  |

_Update this table as specs are added. Numbers are stable ids; sequence by `Depends on`._
