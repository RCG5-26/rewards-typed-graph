# Val — Person B · Frontend / Demo

**Lane:** demo shell, the graph-mutation streaming sidebar, plan-node "lighting up" on invalidation, the baseline contrast UI, demo polish. **You make the invisible coordination visible. The architectural claim is half rendered as a UI element.**

Update Today / Next / Blockers daily. Mirror your one-liner into the STATUS.md grid before standup.

## Today (2026-06-25) — demo flow built end-to-end on fixture data

The full post-sign-in spine runs without a backend: **sign in → pick cards → ask → agent console** at [`/onboarding`](../app/onboarding/page.tsx).

- **Onboarding flow** ([`components/onboarding/`](../components/onboarding/)): `OnboardingFlow` (pick-cards + ask + console), `CardTile` (3D-tilt interactive), `TopBar` (wordmark→home, step rail, account menu = sign-out), `AgentConsole` (streaming), `TypedGraph` (SVG node view).
- **Data layer** (fixture-first / DB-ready, swaps on `DATABASE_URL`): `lib/cards/`, `lib/user/`, `lib/plan/`. Routes: `GET /api/cards` (19-card catalog = 5 seed + 14 curated), `GET /api/me` (Clerk→persona graph), `POST /api/plan`, `GET /api/plan/stream` (SSE).
- **Three visible moments — done:** (1) typed mutations **stream** into the log + light the graph; (2) **Hero Moment 1** — replan: a transfer edge goes stale, revision superseded, new current revision ($1,050→$900); plan-node dependency view lights stale nodes.
- **Identity:** Clerk Google name + avatar via `currentUser()`; any session resolves to the seeded demo persona for graph data (ADR-0006).
- **Design pass:** instrument-grade refinement on design-system tokens — ledger dot-grid, mono numerals, dark full-height wallet rail, staggered card entrances.
- **Status:** on `val/demo-flow` (PR #32); browser-verify authed flow next.

## Next

- Browser-verify the authed fixture flow end-to-end.
- **#4 — real backend:** flip `DATABASE_URL` (swaps all repos to Postgres) + point `/api/plan/stream` at `apps/api` `/mutations` SSE + the real `Orchestrator.run()`.
- **RCG-45/46:** head-to-head baseline contrast + benchmark views (still design-only).

## Blocked on

- nothing. Fixture-first demo runs today; backend API + live SSE are merged on `main` and documented for the swap. Setup + contract: [`../docs/development/backend-local-setup.md`](../docs/development/backend-local-setup.md). API base `http://localhost:8787`, `Authorization: Bearer <getToken()>`, `GET /mutations/stream` for the sidebar, `POST /plans` (synchronous full plan), `fixtures/mock-*.json` for offline.

---

## My tickets

| ID     | Task                                                         | Phase     | Done when                                               |
| ------ | ------------------------------------------------------------ | --------- | ------------------------------------------------------- |
| RCG-24 | Graph-mutation sidebar against mocked data                   | Day 1-5   | mutations stream in visibly                             |
| RCG-27 | Demo shell scaffold (query input, plan + per-step reasoning) | Day 1-5   | persona query renders a multi-step plan                 |
| RCG-26 | Plan-node dependency view: stale nodes light up              | Day 1-5   | invalidation is visible on screen                       |
| RCG-25 | Wire sidebar to real streaming mutation events               | Day 5-7   | live mutations from all agents appear                   |
| RCG-45 | Head-to-head contrast UI (visual diff between architectures) | Day 10-14 | same scenario, typed-graph vs baselines, side by side   |
| RCG-46 | Benchmark numbers display in demo                            | Day 10-14 | accuracy, hallucination, invalidation, token cost shown |

## What the demo needs from me (the three visible moments)

1. Mutations streaming as agents coordinate (sidebar).
2. Hero Moment 1: a balance change marks the current revision stale; a new **current** revision replaces it (prior superseded).
3. Head-to-head: the baseline visibly hallucinates a ratio, misses the invalidation, and re-fetches a tool result.

## My risk

Demo dependency on backend streams. Build on mocked streaming events from Day 3; do not wait for real integration. Lock the event shape with Alan early so the swap to real events (Days 5-7) is trivial.
