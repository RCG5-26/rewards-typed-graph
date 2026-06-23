# Code Standards — [Project Name]

> Implementation rules. When in doubt, match existing code in the repo.

**Last updated:** [YYYY-MM-DD]

---

## General

- Keep modules small and single-purpose.
- Fix root causes — do not layer workarounds.
- Do not mix unrelated concerns in one file or function.
- Respect boundaries in [`architecture-context.md`](architecture-context.md).
- Minimize diff scope — change only what the task requires.

---

## Language & types

_Fill for your stack. Delete sections that don't apply._

### TypeScript / JavaScript

- Strict mode: [yes/no]
- Avoid `any`; validate external input at boundaries.
- Prefer `interface` for object contracts.

### Python

- Type hints on public functions.
- [Formatter: ruff/black] · [Linter: …]

### Other

- [Stack-specific rules]

---

## Framework conventions

### [e.g. Next.js / React]

- Default to [Server Components / server handlers / …].
- Client-only code only when [browser hooks, realtime, etc.].
- [Routing conventions]

### [e.g. API layer]

- Validate input before business logic.
- Auth/authz before mutations.
- Consistent error response shape (see `design-context.md`).

---

## Styling _(UI projects)_

- Use tokens from [`design-context.md`](design-context.md).
- [No raw palette classes / BEM / CSS modules — pick one]
- [Radius, spacing scale if standardized]

---

## Data & persistence

- [Where metadata lives vs blobs vs cache]
- [Migration rules — never edit applied migrations]
- [Transaction boundaries for multi-step writes]

---

## Testing

- **Required before merge:** [unit / integration / e2e / manual checklist]
- **Coverage expectation:** [none / critical paths / % target]
- [How to run: `npm test`, `pytest`, etc.]

---

## File organization

| Directory | Purpose          |
| --------- | ---------------- |
| `[path]`  | [responsibility] |
| `[path]`  | [responsibility] |

**Naming:** [files, components, routes — kebab-case, PascalCase, etc.]

---

## Git & PR conventions

- **Branch naming:** `[pattern, e.g. feature/short-name]`
- **Commit style:** [conventional / imperative sentences]
- **PR size:** [prefer small, one logical change]
- **Review required:** [yes/no, count]

---

## Protected / generated code

Do not modify unless the task explicitly requires it:

- [e.g. `components/ui/*` — shadcn generated]
- [e.g. `app/generated/*` — Prisma client]
- [e.g. vendor / third-party internals]

---

## Security baseline

- No secrets in code, logs, or client bundles.
- Parameterized queries / ORM — no string-built SQL.
- [Project-specific auth rules]

---

## Stack appendix _(optional — project-specific overrides)_

_Detailed rules that don't belong in the generic sections above._

- [Rule]
- [Rule]
