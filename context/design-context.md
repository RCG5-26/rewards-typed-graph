# Design & UX Context — Rewards Agent · Typed Graph (Frontend / Demo)

> Visual language, interaction patterns, and external-facing contracts.

Owner: Val (Person B · Frontend / Demo). The demo's job is to **make the invisible coordination visible** — the architectural claim is half-rendered as a UI element.

**Last updated:** 2026-06-20

---

## Design principles

1. **Make coordination visible** — typed graph mutations stream on screen as agents work; the system's state is the UI.
2. **Clarity over decoration** — the demo must read in 10 minutes, live. Every element earns its place by explaining the architecture.
3. **Show, don't assert** — invalidation, re-planning, and baseline failures are demonstrated visually, not narrated.
4. **One hero moment per view** — each surface lands a single point (mutations streaming, stale nodes lighting up, head-to-head contrast).

---

## Theme & tokens

_Stack: Next.js + custom Tailwind. **Design system + tokens are being added soon** — do not invent colors until then._

| Role | Token / variable | Value / notes |
|---|---|---|
| Background | _pending_ | design-system add (RCG-frontend) |
| Surface | _pending_ | |
| Primary text | _pending_ | |
| Brand / accent | _pending_ | |
| Error / success / warning | _pending_ | error/success used heavily in head-to-head contrast (baseline failures) |

**Rules:**
- Use design tokens only once the system lands — **no hardcoded hex** in components.
- Theme mode (dark / light / both): _TBD with design-system add._

---

## Typography

_Pending design-system add. Note a mono face is needed for IDs and mutation-log fields._

| Role | Font | Usage |
|---|---|---|
| UI | _pending_ | body, labels, plan steps |
| Mono | _pending_ | node IDs, mutation-log entries, JSON fragments |

---

## Layout patterns

| Pattern | Where used | Notes |
|---|---|---|
| App shell | demo shell | NL query input (top/left) + multi-step plan main area + graph-mutation sidebar (right) |
| Streaming sidebar | mutation log (RCG-24/25) | append-only stream of typed mutations as agents coordinate |
| Dependency view | plan-node graph (RCG-26) | plan nodes; stale nodes "light up" on invalidation, then a re-plan appears |
| Side-by-side contrast | head-to-head (RCG-45) | same scenario, typed-graph vs baselines, rendered in parallel columns |
| Metrics panel | benchmark display (RCG-46) | accuracy, hallucination, invalidation, token cost |
| Auth / sign-in | gate (Clerk, likely) | sign-in before demo shell; minimal |

---

## Component library

- **Library:** custom components on Tailwind (no prebuilt UI kit). Design system being added soon.
- **Location:** _TBD_ (likely `components/` + `components/ui/` once the system lands).
- **Rule:** once the design system is in, build from its primitives; do not hand-roll one-off styled elements.

---

## Key UI surfaces

| Surface | Route / component | Primary actions | Data source |
|---|---|---|---|
| Demo shell | `[TBD]` (RCG-27) | enter NL query, view multi-step plan + per-step reasoning | orchestrator (mocked → real Days 5–7) |
| Mutation sidebar | `[TBD]` (RCG-24/25) | observe streaming typed mutations | mutation-log events (mock → real) |
| Plan-node dependency view | `[TBD]` (RCG-26) | watch stale nodes light up, see re-plan | graph invalidation events |
| Head-to-head contrast | `[TBD]` (RCG-45) | run same scenario across architectures | benchmark run output |
| Benchmark numbers | `[TBD]` (RCG-46) | view accuracy / hallucination / invalidation / token cost | benchmark results |
| Sign-in | `[TBD]` | authenticate | Clerk (likely — under evaluation) |

---

## Interaction & feedback

| Event | Expected UX |
|---|---|
| Loading | plan steps stream in incrementally; per-step reasoning appears as it resolves |
| Mutation arrives | new typed entry animates into the sidebar |
| Invalidation | affected plan nodes light up (stale), then a re-plan renders |
| Baseline failure (contrast) | baseline visibly hallucinates a ratio / misses invalidation / re-fetches a tool result |
| Error | _TBD with design-system add (inline vs toast)_ |
| Empty | pre-query state: prompt the persona query |

---

## Accessibility baseline

- Keyboard navigable query input and controls.
- Focus visible on interactive elements.
- Color contrast WCAG AA for text (confirm once tokens land).

---

## API / event contracts (frontend ↔ backend)

### Mutation-log event (sidebar)

Shape to be **locked with Alan (RCG-14)** so the mock → real swap (Days 5–7) is trivial. Mock event shape mirrors the agreed mutation-log fields.

```json
{
  "type": "typed mutation kind — TBD with Alan",
  "node": "graph node id (mono)",
  "agent": "which agent emitted it",
  "ts": "timestamp",
  "payload": "typed fragment — no free text"
}
```

### Card / rewards API

Research **done** — endpoints and response shape understood; feeds the demo shell and informs the mock event design. Concrete request/response shapes to be pinned here when wired.

```json
{
  "_note": "fill from card API research when wiring; capture endpoints + response shape"
}
```

### NL query → plan

```json
{
  "query": "natural-language persona query",
  "plan": [{ "step": "string", "reasoning": "string", "dependsOn": ["node ids"] }]
}
```

---

## Icons & assets

- **Icons:** _TBD with design-system add._
- **Assets path:** _TBD._

---

## Related docs

- Team status board: [`../STATUS.md`](../STATUS.md)
- Frontend lane tracker: [`../tracking/val-frontend.md`](../tracking/val-frontend.md)
- Graph lane (mutation-log shape, RCG-14): [`../tracking/alan-graph.md`](../tracking/alan-graph.md)
- Schema spec: [`../docs/architecture/schema-v2.md`](../docs/architecture/schema-v2.md)
