# Feature Specs

One file per implementable unit — a feature, subsystem, or vertical slice.

---

## Naming

```
NN-short-kebab-name.md
```

- `NN` = two-digit sequence (01, 02, …) or sprint-relative number
- `short-kebab-name` = what it does, not who owns it

Examples: `01-auth.md`, `12-payment-webhook.md`, `03-schema-migration.md`

---

## Workflow

1. Copy [`_template.md`](_template.md) to a new numbered file.
2. Fill all sections before implementation starts.
3. Link from [`progress-tracker.md`](../progress-tracker.md) under **In progress**.
4. When done, move to **Completed** in progress tracker; leave spec file for history.

---

## Spec quality bar

A spec is ready when another developer (or agent) could implement it **without asking product questions**.

Must include:

- Clear **goal** and **out of scope**
- **Acceptance criteria** (testable checkboxes)
- **Files/modules** expected to change
- **Dependencies** on other specs or open decisions

---

## Do not

- Put multiple unrelated features in one spec
- Duplicate content from `project-overview.md` — link instead
- Leave acceptance criteria vague ("works well", "handles errors")

---

## Active specs

| ID | Spec | Status | Owner |
|---|---|---|---|
| [NN] | [link](NN-name.md) | proposed / in progress / done | [Name] |

_Update this table as specs are added._
