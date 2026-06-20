# Design & UX Context — [Project Name]

> Visual language, interaction patterns, and external-facing contracts.

**Skip or minimal fill** for backend-only, CLI, or library projects. Keep the **Integration contracts** section if the project exposes an API.

**Last updated:** [YYYY-MM-DD]

---

## Design principles

1. [e.g. "Clarity over decoration"]
2. [e.g. "One primary action per screen"]
3. [Add 2–4 principles]

---

## Theme & tokens

_Document how styling works so agents don't invent colors._

| Role | Token / variable | Value / notes |
|---|---|---|
| Background | `[e.g. --bg-base]` | [value or "see globals.css"] |
| Surface | `[e.g. --bg-surface]` | |
| Primary text | | |
| Brand / accent | | |
| Error / success / warning | | |

**Rules:**
- [e.g. "Use design tokens only — no hardcoded hex in components"]
- [e.g. "Dark-only / light-only / both"]

---

## Typography

| Role | Font | Usage |
|---|---|---|
| UI | [font] | body, labels |
| Mono | [font] | code, IDs |

---

## Layout patterns

Describe recurring layouts (not every page).

| Pattern | Where used | Notes |
|---|---|---|
| [e.g. App shell] | [routes] | [sidebar + main + optional panel] |
| [e.g. Modal] | [dialogs] | [size, dismiss behavior] |
| [e.g. Empty state] | [lists] | [icon + CTA pattern] |

---

## Component library

- **Library:** [e.g. shadcn/ui, MUI, custom]
- **Location:** `[path, e.g. components/ui/]`
- **Rule:** [e.g. "Do not modify generated foundation components unless task explicitly requires it"]

---

## Key UI surfaces

_List screens/views agents will touch. One row each._

| Surface | Route / component | Primary actions | Data source |
|---|---|---|---|
| [e.g. Home] | `[path]` | [create, list] | [API] |
| [e.g. Detail] | `[path]` | [edit, delete] | [API] |

---

## Interaction & feedback

| Event | Expected UX |
|---|---|
| Loading | [spinner, skeleton, optimistic] |
| Error | [toast, inline, retry] |
| Success | [toast, redirect] |
| Empty | [illustration + CTA] |

---

## Accessibility baseline

- [e.g. "Keyboard navigable forms"]
- [e.g. "Focus visible on interactive elements"]
- [e.g. "Color contrast WCAG AA for text"]

---

## API / event contracts (frontend ↔ backend)

_Fill even for API-only projects._

### [Contract name, e.g. "Mutation log event"]

```json
{
  "field": "type and meaning",
  "example": "value"
}
```

### [Contract name, e.g. "REST error shape"]

```json
{
  "error": "string",
  "code": "optional machine code"
}
```

---

## Icons & assets

- **Icons:** [library, e.g. Lucide]
- **Assets path:** `[path]`

---

## Related docs

- Architecture: [`architecture-context.md`](architecture-context.md)
- Feature specs: [`feature-specs/`](feature-specs/)
