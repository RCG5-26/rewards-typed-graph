# Malleable UI — Design System

The visual language for the Rewards Agent typed-graph demo. **Tokens are the single source of truth**; components and Tailwind utilities only reference tokens, never raw values. Job of the demo's UI: _make the invisible coordination visible_ — so the system ships lifecycle/status tokens as first-class citizens.

> **Rule:** no hardcoded hex, px, or easing anywhere in app code. If a value isn't a token yet, add a token first, then use it.

---

## Layout

```
design-system/
├── global.css            ← import ONCE at the app root (sets global fonts + base)
├── styles.css            ← tokens-only entry (@import for isolated component bundles)
├── tailwind-preset.js    ← maps tokens → Tailwind theme (bg-surface, rounded-card, …)
└── tokens/
    ├── fonts.css         ← @font-face (SF Pro Text/Display, Fira Code)
    ├── colors.css        ← iris + neutral scales, semantic surface/text/border
    ├── status.css        ← feedback (success/warning/error) + plan/step lifecycle
    ├── typography.css    ← size / weight / tracking / leading + semantic type roles
    ├── spacing.css       ← 4px scale, semantic gaps/padding, border radii
    ├── effects.css       ← shadows, blur, glass, blob glow
    └── motion.css        ← spring easings, durations, named transitions

(No components yet — build them in the app's `components/ui/` from tokens + preset.)
```

---

## How to use it

### 1. Set global fonts + base (once)

In the Next.js app root — `app/layout.tsx` (or `app/globals.css`):

```ts
// app/layout.tsx
import "../design-system/global.css";
```

`global.css` pulls in every token + `@font-face`, sets `font: var(--type-body)` on
`body`, the display face on headings, the background, focus rings, and reduced-motion
handling. After this, every element inherits the system font — you don't set fonts
per-component.

### 2. Wire the Tailwind preset

```js
// tailwind.config.js
const ds = require("./design-system/tailwind-preset");

module.exports = {
  presets: [ds],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
};
```

Now token-backed utilities exist:

```tsx
<div className="bg-surface text-text-secondary rounded-card shadow-card p-6">
  <h2 className="font-display text-2xl tracking-tight">Plan</h2>
</div>
```

### 3. Use tokens directly when you need raw CSS

```css
.mutation-row {
  font: var(--type-mono);
  border-left: 2px solid var(--mutation-rail);
  border-radius: var(--radius-cell);
  transition: var(--transition-pop);
}
```

### 4. Build components from tokens

No component code ships yet — by design. Build app primitives as small,
token-backed Tailwind components in `components/ui/` when you scaffold the shell,
and map each one here (props + tokens) as you add it.

```tsx
// components/ui/Tag.tsx — example: lifecycle chip driven entirely by status tokens
const STATUS = {
  current:    "bg-status-current-bg text-status-current",
  stale:      "bg-status-stale-bg text-status-stale",
  superseded: "bg-status-superseded-bg text-status-superseded",
  failed:     "bg-status-failed-bg text-status-failed",
} as const;

export function Tag({ status, children }: { status: keyof typeof STATUS; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-chip px-2 py-1 text-xs font-medium ${STATUS[status]}`}>
      {children}
    </span>
  );
}
```

Planned primitives (build as needed): `Button` (run query / scenario), `Card`
(plan-step + metric panels), `Tag` (lifecycle chips), `CommandInput` (NL query bar),
`Blob` (ambient state — the one case where a canvas/inline-style component is
warranted).

---

## Token reference (cheat sheet)

**Surfaces & text** — `--color-bg`, `--color-surface`, `--color-surface-raised`,
`--color-text-primary/secondary/tertiary`, `--color-border/-strong/-subtle`.

**Accent (iris)** — `--color-accent` (=iris-500), `--color-accent-fg/-text/-subtle/-muted`;
raw scale `--color-iris-50…900`, neutrals `--color-neutral-0…900`.

**Feedback** — `--color-success`, `--color-warning`, `--color-error` (each with
`-bg` / `-fg` variants). Used heavily in head-to-head contrast.

**Plan / step lifecycle** (maps 1:1 to `plans.status` / `plan_steps.status`):

| State | Color token | Background |
|---|---|---|
| generating | `--status-generating` | `--status-generating-bg` |
| proposed | `--status-proposed` | `--status-proposed-bg` |
| current | `--status-current` | `--status-current-bg` |
| stale | `--status-stale` | `--status-stale-bg` |
| superseded | `--status-superseded` | `--status-superseded-bg` |
| failed | `--status-failed` | `--status-failed-bg` |

**Mutation log** — `--mutation-accent`, `--mutation-rail`.

**Type roles** (shorthand `font:` values) — `--type-display`, `--type-headline`,
`--type-title`, `--type-body-lg`, `--type-body`, `--type-body-sm`, `--type-label`,
`--type-caption`, `--type-overline`, `--type-mono`.

**Spacing** — 4px base `--space-0…32`; semantic `--gap-xs…xl`, `--padding-card*`,
`--padding-button*`. **Radii** — `--radius-xs…3xl`, `--radius-full`, plus semantic
`--radius-button/card/input/chip/cell`.

**Effects** — `--shadow-xs…xl` + `--shadow-card/raised/float`; `--blur-sm…xl`;
glass `--glass-light/mid/dark`; `--blob-glow-sm/md/lg`.

**Motion** — springs `--spring-snappy/bounce/gentle/settle`; `--ease-soft`;
durations `--duration-instant…breathe`; named `--transition-color/opacity/pop/collapse`.

---

## Fonts

`tokens/fonts.css` declares **SF Pro Text** / **SF Pro Display** via `local()` (resolves
on macOS/iOS automatically) and **Fira Code** (mono, SIL OFL) via CDN with a `local()`
fast path. To ship to non-Apple platforms, drop licensed `.woff2` files in the consuming
app's static font dir (e.g. `public/fonts/`) and point the `url()` entries in the existing
`@font-face` blocks at it — no other file changes needed. Mono is required for node IDs
and mutation-log fields.

---

## Conventions

- **Tokens before components.** New visual value → add a token, then consume it.
- **Status is data.** Read every node/chip color from a `--status-*` token so the UI
  is a faithful render of `plans.status` / `plan_steps.status`.
- **Two-layer shadows only** (diffuse + sharp) — already baked into `--shadow-*`.
- **Springs for transform, `--ease-soft` for color/opacity.**
- **Accessibility:** focus rings and reduced-motion are handled in `global.css`;
  keep text contrast at WCAG AA (neutral-600 on surface is the floor for body).

See [`../context/design-context.md`](../context/design-context.md) for how these tokens
map onto each demo surface.
