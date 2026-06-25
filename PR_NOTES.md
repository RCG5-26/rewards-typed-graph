# PR review notes — known gaps & follow-ups

Scope of this PR: console polish (round/fuzzy circular constellation, clickable
node details, aligned + legible mutation-log badges), the real-orchestrator
wiring (live plan + `graph_mutations` with fixture fallback), live-derived
baselines/benchmark tabs, and the plan-dependency graph with stale propagation.

These are **known gaps left intentionally** — flagged here so review doesn't read
them as oversights.

## Not addressed in this PR (raised in review)

- **Keyboard / screen-reader node selection** (a11y). The typed-graph canvas now
  drives `onSelect`, but it stays `aria-hidden` and non-focusable, so the node
  detail panel is mouse-only. Proper fix = visually-hidden focusable buttons
  (one per hub) that call `onSelect`. *Deferred — heavier lift on a decorative
  canvas.*
- **Completion after a failed live write.** With `API_BASE_URL` set, a failed
  live plan/transfer falls back to the deterministic fixture and still emits a
  normal `meta`/`done` (logged via `console.warn`). This is **intentional
  graceful degradation** so the demo never hard-fails. Optional hardening: add a
  `degraded: true` flag to the `done` event + a "demo mode" badge so the fallback
  is visible. *Not done — would change demo behavior.*

## Cross-lane / backend (cannot be done or verified in the web repo)

- **Native node-id lighting.** Real `graph_mutations` rows carry plan/step UUIDs,
  not `prog:<slug>` ids, so node-lighting (log **and** dependency graph) follows
  the derived traversal order, not the row's real target. Needs the backend to
  emit a stable `graph_node_id` per row (cleanest in the `after` JSONB), plus
  slug-format reconciliation (`program:chase_ur` vs `prog:chase_ur`) and a tweak
  to the SQL `transfer_points()` function. ~half-day, low difficulty, untestable
  here.
- **"All agents" live commits.** Wallet/earning agents are scaffold-mocked, so the
  live `/mutations/stream` tail bursts on one synchronous commit instead of
  streaming per-agent. Needs the orchestrator to actually run those agents.
- **Dependency graph is synthetic.** The `planGraph` (nodes + dependency edges) is
  built by the fixture builder, not read from the backend's persisted
  `state_dependencies` rows. Structure is faithful; source is not yet real.

## Inherent (no second architecture actually runs)

- **Baseline narratives are illustrative.** CrewAI / single-agent failure bullets
  and the benchmark accuracy / hallucination rows are fixtures. Only plan value,
  token cost, and invalidations-caught are live-derived from the run.

## Verification

- **No end-to-end run against live Postgres + the Hono API.** All backend paths
  (real plan, mutations, live tail, replan transfer) are `tsc` + `eslint` clean
  only. The fixture fallback preserves current behavior with no backend.
- **`vitest` is not runnable in this environment** (`Cannot find module
  'vitest/config'`) — pre-existing, unrelated to these changes.

## Cosmetic

- **Constellation position** — the circular field's center/radius
  (`fieldCx`/`fieldCy`/`fieldR` in `components/onboarding/TypedGraph.tsx`) is a
  first guess and may need a nudge to recenter.
