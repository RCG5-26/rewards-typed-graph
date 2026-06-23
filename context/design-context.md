# Design & UX Context — Rewards Agent · Typed Graph (Frontend / Demo)

> Visual language, interaction patterns, and external-facing contracts.

Owner: Val (Person B · Frontend / Demo). The demo's job is to **make the invisible coordination visible** — the architectural claim is half-rendered as a UI element.

**Last updated:** 2026-06-22

> **Design system landed.** Tokens, fonts, and the Tailwind preset live in [`../design-system/`](../design-system/) (components are built in the app from these — none ship in the design system yet). Usage guide: [`design-system/README.md`](../design-system/README.md). **No hardcoded hex/px** — reference tokens only.

---

## Design principles

1. **Make coordination visible** — typed graph mutations stream on screen as agents work; the system's state is the UI.
2. **Clarity over decoration** — the demo must read in 10 minutes, live. Every element earns its place by explaining the architecture.
3. **Show, don't assert** — invalidation, re-planning, and baseline failures are demonstrated visually, not narrated.
4. **One hero moment per view** — each surface lands a single point (mutations streaming, stale nodes lighting up, head-to-head contrast).

---

## Theme & tokens

_Stack: Next.js + custom Tailwind. Design system installed at [`../design-system/`](../design-system/). Wire it via the [Tailwind preset](../design-system/tailwind-preset.js) (`bg-surface`, `rounded-card`, …) and import [`global.css`](../design-system/global.css) once at the app root. Colors are defined in [`tokens/colors.css`](../design-system/tokens/colors.css) and [`tokens/status.css`](../design-system/tokens/status.css)._

| Role | Token / variable | Value / notes |
|---|---|---|
| Background | `--color-bg` | cool grey (neutral-100); page canvas |
| Surface | `--color-surface` / `--color-surface-raised` | white / neutral-50 cards & panels |
| Primary text | `--color-text-primary` | neutral-900 (secondary/tertiary/disabled also defined) |
| Brand / accent | `--color-accent` (= `--color-iris-500`) | iris/periwinkle scale `--color-iris-50…900`; `-fg`/`-text`/`-subtle`/`-muted` aliases |
| Border | `--color-border` / `-strong` / `-subtle` | translucent black hairlines |
| Error / success / warning | `--color-error` / `--color-success` / `--color-warning` (+ `-bg`/`-fg`) | used heavily in head-to-head contrast (baseline failures) |

**Plan/step lifecycle colors** (map 1:1 to `plans.status` / `plan_steps.status`) — drive every node + chip from these, never a literal: `--status-generating`, `--status-proposed`, `--status-current`, `--status-stale`, `--status-superseded`, `--status-failed` (each with a `-bg` pair). Mutation log: `--mutation-accent`, `--mutation-rail`.

**Rules:**
- **No hardcoded hex** in components — reference tokens (or preset utilities) only.
- Theme mode: **light only** for the demo. Tokens are semantic aliases over raw scales, so a dark map can be added later without touching component code.

---

## Typography

_Defined in [`tokens/typography.css`](../design-system/tokens/typography.css); faces declared in [`tokens/fonts.css`](../design-system/tokens/fonts.css). Global font is set on `body` by [`global.css`](../design-system/global.css) — inherit it, don't set per-component. Use the semantic `--type-*` roles (shorthand `font:` values) rather than raw size/weight tokens._

| Role | Font (token) | Usage |
|---|---|---|
| UI / body | `--font-sans` (SF Pro Text) | body, labels, plan steps — roles `--type-body`, `--type-body-sm`, `--type-label` |
| Display | `--font-display` (SF Pro Display) | headings/titles — `--type-display`, `--type-headline`, `--type-title` |
| Mono | `--font-mono` (Fira Code) | node IDs, mutation-log entries, JSON fragments — role `--type-mono` |

Scale: `--text-2xs…5xl` · weights `--weight-thin…semibold` · tracking `--tracking-*` · leading `--leading-*`.

---

## Layout patterns

| Pattern | Where used | Notes |
|---|---|---|
| App shell | demo shell | NL query input (top/left) + multi-step plan main area + graph-mutation sidebar (right) |
| Streaming sidebar | mutation log (RCG-24/25) | append-only stream of typed mutations as agents coordinate |
| Dependency view | plan-node graph (RCG-26) | stale steps/revision light up on invalidation; new **current** revision replaces prior (superseded) |
| Side-by-side contrast | head-to-head (RCG-45) | same scenario, typed-graph vs baselines, rendered in parallel columns |
| Metrics panel | benchmark display (RCG-46) | accuracy, hallucination, invalidation, token cost |
| Auth / sign-in | gate (Clerk) | Clerk identity-only sign-in before demo shell ([ADR 0006](../docs/adr/0006-clerk-identity-only.md)) |
| Marketing landing | GPFree cinematic landing (`components/gpfree/`) | scroll-driven hero + how-it-works + footer; **fully token-driven** (light surfaces, iris accent, SF Pro/Fira Code) — no hardcoded hex/px/easing (D028) |

---

## GPFree landing surface (`components/gpfree/`)

The public landing conforms to the design system end-to-end (D028). Structure:
`GPFreeHero` (composition + root) → `cinema.ts` (shared token styles + `useGpxCinema` scroll engine) → `HeroStage` / `HowItWorks` / `SiteFooter`.

- **Color** off `--color-bg` / `--color-surface*` / `--color-text-*` / `--color-accent*` / `--color-border*`; alpha variants via `color-mix(... var(--token) ...)`, never raw `rgba()`.
- **Type** off `--font-display` (headings), `--font-sans` (body/CTA), `--font-mono` (labels/typewriters) + the `--text-*` / `--weight-*` / `--tracking-*` / `--leading-*` scales.
- **Spacing / radii / shadows** off `--space-*` / `--radius-*` / `--shadow-*`; **motion** off `--ease-soft` / `--spring-settle` / `--duration-*`.
- Engine-applied styles (active step tab, glow, progress bar) also write token values, so the imperative layer stays token-true.
- Bespoke geometry (frame positions, illustration card sizes, viewport breakpoints) stays as literals — no token exists for one-off coordinates.

---

## Component library

- **Library:** Malleable UI — custom components on Tailwind (no prebuilt UI kit), all token-backed.
- **Location:** tokens + fonts + Tailwind preset at [`../design-system/`](../design-system/); app components built in `components/ui/` once the shell is scaffolded. No component code ships in the design system yet — by design.
- **Planned primitives:** `Button`, `Card`, `Tag`, `CommandInput`, `Blob` — build as token-backed Tailwind components when needed (pattern + cheat sheet in [`design-system/README.md`](../design-system/README.md)).
- **Rule:** build from tokens + the Tailwind preset; map any new component (props → tokens) in the design-system README. Do not hand-roll one-off styled elements or literal values.

---

## Key UI surfaces

| Surface | Route / component | Primary actions | Data source |
|---|---|---|---|
| Demo shell | `[TBD]` (RCG-27) | enter NL query; view multi-step plan + per-step reasoning; only `status = current` revision actionable | orchestrator (mocked → real Days 5–7) |
| Mutation sidebar | `[TBD]` (RCG-24/25) | observe streaming typed mutations (`graph_mutations` / SSE) | SSE replay + REST catch-up (mock → real) |
| Plan-node dependency view | `[TBD]` (RCG-26) | watch stale steps/revision; see new current revision promoted | invalidation + replan lifecycle events |
| Head-to-head contrast | `[TBD]` (RCG-45) | run same scenario across architectures | benchmark run output |
| Benchmark numbers | `[TBD]` (RCG-46) | view accuracy / hallucination / invalidation / token cost | benchmark results |
| Sign-in | `[TBD]` | authenticate | Clerk (identity-only; per-user demo persona) |

---

## Interaction & feedback

| Event | Expected UX |
|---|---|
| Loading | plan steps stream in incrementally; per-step reasoning appears as it resolves |
| Mutation arrives | new typed entry animates into the sidebar |
| Invalidation | affected plan revision → `stale`; steps → `stale`; then new revision promoted to **`current`** (prior → `superseded`) |
| Baseline failure (contrast) | baseline visibly hallucinates a ratio / misses invalidation / re-fetches a tool result |
| Error | inline, token-colored with `--color-error` / `-bg` / `-fg`; baseline failures render in the contrast column, not a toast |
| Empty | pre-query state: prompt the persona query |

---

## Accessibility baseline

- Keyboard navigable query input and controls.
- Focus visible on interactive elements — handled globally by [`global.css`](../design-system/global.css) (`:focus-visible` ring on `--color-accent`).
- `prefers-reduced-motion` honored globally (springs/breathe neutralized) — also in `global.css`.
- Color contrast WCAG AA for text: `--color-text-secondary` (neutral-600) on `--color-surface` is the body floor; don't go lighter for body copy.

---

## API / event contracts (frontend ↔ backend)

### SSE mutation event (sidebar)

**One event per `graph_mutations` row** (not a transaction-level batch). Canonical contract: [`schema/contracts/mutation-event.schema.json`](../schema/contracts/mutation-event.schema.json) ([spec 03](feature-specs/03-mutation-log-sse.md), ADR 0008). **REST is source of truth**; SSE is observability — reconnect via `GET /mutations?after=` using `event_id` (= row `id`).

```json
{
  "event_id": "12345",
  "mutation_txn_id": "uuid",
  "user_id": "uuid",
  "plan_lineage_id": "uuid or null",
  "plan_id": "uuid or null",
  "agent_run_id": "uuid or null",
  "mutation_type": "TransferPoints",
  "target_table": "user_balances",
  "target_node_id": "uuid or null",
  "summary": "Transfer 5000 pts AAdvantage → Hyatt",
  "before": { "balance": 12000, "version": 3 },
  "after": { "balance": 7000, "version": 4 },
  "committed_at": "2026-06-20T12:00:00Z"
}
```

### Card / rewards API

Research **done** — endpoints and response shape understood; feeds the demo shell and informs the mock event design. Concrete request/response shapes to be pinned here when wired.

```json
{
  "_note": "fill from card API research when wiring; capture endpoints + response shape"
}
```

### NL query → plan (mock)

```json
{
  "query": "natural-language persona query",
  "plan_lineage_id": "uuid",
  "status": "generating | current | stale | failed | superseded",
  "steps": [
    {
      "step": "string",
      "reasoning": "string",
      "status": "proposed | current | stale | superseded",
      "dependsOn": ["node ids"]
    }
  ]
}
```

---

## Icons & assets

- **Icons:** inline SVG, sized in `em` and colored via `currentColor` so they inherit token text colors. Add a shared `components/ui/Icon` set as surfaces are built.
- **Fonts/assets path:** webfonts resolve via `local()` (SF Pro) + CDN (Fira Code); for non-Apple self-hosting, drop `.woff2` into the consuming app's static font dir (e.g. `public/fonts/`) and point the `url()` entries in [`tokens/fonts.css`](../design-system/tokens/fonts.css) at it.

---

## Related docs

- **Design system + usage guide: [`../design-system/README.md`](../design-system/README.md)** (tokens, fonts, Tailwind preset; planned primitives/patterns)
- Architecture (SSE, lifecycle, Clerk): [`architecture-context.md`](architecture-context.md)
- Product overview: [`project-overview.md`](project-overview.md)
- Team status board: [`../STATUS.md`](../STATUS.md)
- Frontend lane tracker: [`../tracking/val-frontend.md`](../tracking/val-frontend.md)
- Graph lane (contracts, RCG-14): [`../tracking/alan-graph.md`](../tracking/alan-graph.md)
- Schema spec: [`../docs/architecture/schema-final.md`](../docs/architecture/schema-final.md) **v3.1**
- SSE event contract: [`../schema/contracts/mutation-event.schema.json`](../schema/contracts/mutation-event.schema.json)
- ADR 0006 (Clerk): [`../docs/adr/0006-clerk-identity-only.md`](../docs/adr/0006-clerk-identity-only.md)
- ADR 0008 (SSE): [`../docs/adr/0008-per-user-serialization-sse.md`](../docs/adr/0008-per-user-serialization-sse.md)
