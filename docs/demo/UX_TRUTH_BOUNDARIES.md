# UX Truth Boundaries — Demo Coherence Pass

> Every visible surface is classified by what produces it, so the UI never
> blurs live execution, precomputed evidence, and illustrative preview. This
> document is the source of truth for the on-screen labels added in the
> demo-safe coherence pass (branch `demo/ux-polish-final`).

**Last verified:** 2026-06-29, against SHA `14da1c3` (worktree `gpFree-ux-polish`).

---

## Categories

| Category | Meaning |
|---|---|
| **Live PostgreSQL state** | Read/written against the real graph DB during the demo. |
| **Live planner execution** | A real planner run (graph orchestrator `createPlan` / replan). |
| **Live OpenAI execution** | A real LLM subprocess call (baseline adapters). |
| **Deterministic evaluation** | The architecture-blind scorer producing `PlanEvaluation`. |
| **Precomputed benchmark artifact** | A captured, versioned JSON read at render time. |
| **Illustrative UI preview** | Sample/scaffolding content shown to demonstrate presentation, not derived from a live run. |

---

## Surface map (as-built)

| Surface | Route / component | Category | Notes |
|---|---|---|---|
| Landing | `/` · `GPFreeHero.tsx` | **Illustrative UI preview** | All values (points, travel value, card face) are sample copy. Labeled as an example; no user data is shown. |
| Wallet picker / balances | `/onboarding` · `OnboardingFlow` | **Live PostgreSQL state** (cards/me/facts) | `GET /api/cards`, `/api/me`, `/api/demo/test-wallets`. Projected value = honest per-card portfolio math (signup bonus × CPP − fee). |
| Plan preview (AgentConsole) | `/onboarding` step 03 · `AgentConsole.tsx` | **Illustrative UI preview** | Plan stream + `RouteBar` program names are scaffolding; the "tokens vs baseline" figure is a **live numerator over an illustrative (synthetic) baseline projection** (`lib/plan/comparison.ts`), not a measured second architecture. Labeled accordingly. |
| Live Planner Comparison | `/test-wallets` · `TestWalletComparison.tsx` | **Live planner + Live OpenAI + Deterministic evaluation** | Graph lane = real `PlanService.createPlan` (needs `PLAN_ENGINE=graph`); chat-crew + single-agent = real Python LLM subprocesses (need `OPENAI_API_KEY`). |
| Replan | `/test-wallets` · `ReplanStatusPanel` | **Live PostgreSQL state + Live planner execution** | `replanService.transferBalance` returns a real `replanJobId` + `revisionNumber`. The `v1→v2` balance labels and "rev1 stale→superseded" narration are **illustrative scaffolding** rendered beside the live revision. |
| Benchmark | `/benchmark` · `BenchmarkView` | **Precomputed benchmark artifact** | `lib/benchmark/architecture-comparison.json` (`benchmarkId: person-c-mvp-redemption-v1`, `evaluatorVersion: person-c-offline-scorer-v1`, 30 cases). Typed-graph measured; LLM baselines `not_run`. |

---

## Degradation contract (verified — no silent fabrication)

The live comparison and replan paths **never** substitute fabricated output for a
failed live run. Verified at SHA `14da1c3`:

- `lib/comparison/client.ts` throws `PublicApiError` (upstream status/message) or
  aborts on timeout — no fixture fallback.
- `app/api/demo/{architecture-comparison,test-wallets,simulate-transfer}/route.ts`
  forward a sanitized status/message or a generic `502` — no fixture substitution.
- Backend adapters return a per-architecture **`failed`** slot (not a fabricated
  plan) when `PLAN_ENGINE`/keys are absent.

Allowed degraded states: `partial success`, `failed architecture slot`,
`timeout`, `sanitized error`, `explicitly labeled fixture mode`.
**Not allowed:** a live failure silently rendering a fixture result.

---

## Presentation-safe claims (carried from `DEMO_SPRINT_FREEZE.md` §12)

**May state:** the graph orchestrator initial-plan flow runs end-to-end on real
PostgreSQL; both LLM baselines execute live against OpenAI; the canonical
transfer-required wallet is numerically proven (shortfall 15,000).

**May NOT state:** that the three architectures were compared on perfectly equal
inputs unless the data-world alignment is in place; that the baselines
"hallucinated" (the `award_not_in_tool_result` flag is an evaluator-vocabulary
boundary mismatch); that the live TypeScript orchestrator ran the full 30-case
suite (it did not — the 30-case suite is the precomputed fixture benchmark).
