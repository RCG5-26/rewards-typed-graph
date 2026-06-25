# Sprint Plan — MVP to Demo (Jun 24 → 29)

> Refreshed Wed Jun 24 from a full `main` + Linear audit. Two lines in the sand:
> **MVP hero test green — Thu Jun 25** · **Live 10-min demo — Mon Jun 29.**
> The core backend pieces are in place; spec 07 HTTP service is implemented in PR #29 (`raq/demo-mocks`). The remaining work is the *visible demo* shell, benchmark/baselines, and the manual Clerk smoke on the live API. Protect those; add no new backend features.

---

## 1. Where we are (audit, Jun 24)

**Done and merged to `main` (21 tickets) — the entire backend + foundations:**

- Graph + write path: schema v3.1 + DDL (RCG-5–7, 9, 10, 61), OCC (RCG-11), recursive-CTE traversal `schema/queries.py` (RCG-12), dependency tracking (RCG-13), mutation log + REST/SSE routes (RCG-14), plan lineage / replan_jobs queue / idempotency (RCG-56–58), per-user advisory lock + SSE ordering (RCG-59), demo seed + loader (RCG-8).
- Orchestrator + agent harness `apps/api/src/orchestrator/*` (RCG-15).
- Redemption agent + award tool `agents/redemption/*` (RCG-20–22).
- Frontend foundation: design system (RCG-64), Clerk Google-only auth (RCG-65), 3D landing.

**In progress (4):**

| Ticket | What's real | What's missing |
|---|---|---|
| RCG-28 / RCG-29 | `hero_flow.py` wires `create_plan_from_query` + `replan_after_balance_transfer`; `docker-compose.yml` + `dev-db-setup.sh` merged | **Not green** end-to-end on live Postgres → this is the MVP gate |
| RCG-27 | landing + auth only | the actual demo shell (query input, plan + per-step reasoning) does not exist yet |
| RCG-33 | 11 of 30 gold cases + offline scorer | finish to target count; wire to harness |

**The gap (not started in code):** the whole visible demo UI (shell, mutation sidebar, stale-node view, head-to-head), both baselines, the benchmark runner, and demo assembly.

---

## 2. The two gates

**MVP — Thu Jun 25:** the hero path is green on shared Postgres.

```bash
RUN_LIVE_POSTGRES_TESTS=1 PGDATABASE=rewards_test \
  python3 -m unittest tests.integration.test_hero_moment.HeroMomentIntegrationTest.test_hero_end_to_end -v
```

All the pieces are merged; this is wiring + debugging, not new features. Owners: **Raq + Michael.**

**Demo — Mon Jun 29 (10 min):** sign in → seeded Tokyo persona → NL query → multi-step plan with per-step reasoning → mutation sidebar streaming → **Hero Moment 1** (balance change → stale nodes → auto re-plan) → head-to-head vs both baselines with numbers → close on the contribution.

---

## 3. Critical path & risk

1. **Frontend demo UI is the long pole.** Only the landing + auth exist; the shell, sidebar, stale-node view, and head-to-head are all unbuilt and they *are* the persuasion. **Decision (Jun 24): all frontend stays with Val — two-day target for the shell + sidebar (by EOD Jun 26).** She is unblocked on mocks today; the two real dependencies are (a) a filled mock-data bundle to build against (now committed in this PR) and (b) a `query → plan` HTTP endpoint from Raq by Fri so she can swap mocks for real (see §8).
2. **Benchmark + 2 baselines are the research claim** and aren't started in code. Michael leads; Raq owns the single-agent baseline + harness.
3. **Core backend is done; spec 07 HTTP service is in PR #29 (Raq).** No new backend features. Alan shifts to eval instrumentation, perf/bugfix, and frontend/infra backstop.

---

## 4. Scope decisions (recommended — lead confirms)

| Decision | Recommendation | Why |
|---|---|---|
| Layer 4 (ingestion/verifier, Hero Moment 2) | **NO-GO now** — don't wait for the Jun 26 date | Frees Michael for baselines + benchmark; it was cut-by-default (ADR 0003) |
| Wallet + earning agents (RCG-16/17) | **Defer** | Hero is redemption-only; add earning only if the multi-step plan needs a 2nd agent and time allows |
| Real cash-price tool (RCG-30) | **Cut** — fixtures only | Not visible in the demo |
| Hosted runtime (RCG-60) | **Minimal** — demo on local docker-compose or one managed PG | No deploy polish needed for a live demo |
| 30-query benchmark (RCG-33) | **Target 30; floor 20** | An honest 20 beats a rushed 30; both baselines stay first-class |
| Sidebar → real SSE (RCG-25) | Real if Val has time; else **mock/replay events** | The log is real; the demo reads the same shape either way |

---

## 5. Day-by-day (owners)

**Wed Jun 24 (today)**
- **Raq + Michael:** get `test_hero_end_to_end` green on docker-compose (RCG-28/29/32). #1 priority, everything else waits behind it.
- **Val:** start the demo shell — query input + plan/per-step reasoning against a mock plan JSON (RCG-27).
- **Alan:** unblock the hero path (seed load, any write-path bug); then begin eval instrumentation (RCG-52).

**Thu Jun 25 — MVP GATE**
- **AM:** confirm hero green → RCG-28/29/32 Done. If slipping, all hands on the hero path.
- **Val:** mutation sidebar on mock events (RCG-24) + stale plan-node view (RCG-26).
- **Michael:** benchmark to target (RCG-33) + start free-text CrewAI baseline (RCG-36).
- **Raq:** single-agent baseline (RCG-35) + eval-harness skeleton (RCG-40).

**Fri Jun 26**
- **Val:** wire the shell + sidebar to the real orchestrator + SSE (RCG-25); replace mocks.
- **Michael:** finish both baselines; run benchmark across all three architectures (RCG-37); metrics (RCG-34/38/54).
- **Raq:** harness runs all three; collect numbers (RCG-40); integration glue.
- **Alan:** eval instrumentation (RCG-52/53); perf + bugfix; keep shared Postgres / infra healthy.

**Sat Jun 27**
- **Val:** head-to-head contrast UI (RCG-45) + benchmark numbers display (RCG-46).
- **Raq + Michael:** lock + freeze benchmark numbers (RCG-55 thresholds).
- **Raq:** demo script draft (RCG-47); end-to-end integration test (RCG-63).

**Sun Jun 28**
- Polish; **rehearsal #1 and #2** (RCG-48); fix fragile transitions.
- Rehearse the clean cut-Layer-4 path (RCG-51); use [`../demo/layer4-cut-contingency.md`](../demo/layer4-cut-contingency.md). Freeze code; demo-blocking fixes only.

**Mon Jun 29 — DEMO**
- **AM:** rehearsal #3; final check (auth → seed → query → plan → sidebar → hero re-plan → head-to-head numbers).
- 10-minute live demo.

---

## 6. Demo readiness checklist (must be true Jun 29)

- [ ] Google sign-in → seeded Tokyo persona (5 cards, 240k pts, 3 programs) loads
- [ ] NL query → multi-step plan with per-step reasoning visible
- [ ] Mutation sidebar streams as agents commit
- [ ] Balance change → dependent plan nodes light up stale → redemption agent auto re-plans (Hero Moment 1)
- [ ] Head-to-head vs single-agent + free-text baselines: accuracy, hallucination rate, plan-invalidation correctness
- [ ] Closing: the contribution is the coordination primitive + the maintenance loop
- [x] Hero Moment 2 (Layer 4): **cut** — state cleanly if asked; see [`../demo/layer4-cut-contingency.md`](../demo/layer4-cut-contingency.md)

---

## 7. Ticket buckets

- **MVP (Jun 25):** RCG-28, RCG-29, RCG-32
- **Demo-critical (Jun 26–28):**
  - Frontend: RCG-27, 24, 25, 26, 45, 46
  - Benchmark + baselines: RCG-33, 35, 36, 37, 34, 38, 54, 40
  - Demo assembly: RCG-47, 48, 63, 55
- **Cut / defer:** RCG-16, 17 (agents) · RCG-30 (cash-price) · RCG-60 (hosted) · RCG-41–44, 50 (Layer 4) · RCG-39 (→ NO-GO) · RCG-49 (release set) · RCG-18, 19, 23, 31 · RCG-52, 53 (instrumentation if time) · RCG-62 (report → post-demo)

---

## 8. Frontend readiness — can Val start the shell now?

**Yes, on mocks — every contract she renders against is on `main`:**

- **Plan + per-step shape:** the `NL query → plan` mock contract in [`design-context.md`](../../context/design-context.md) (`query`, `plan_lineage_id`, `status`, `steps[{step, reasoning, status, dependsOn}]`), backed by generated types (`schema/generated/types.ts`: `Plan`, `PlanStep`) and `apps/api/src/orchestrator/contracts.ts` (`PlanResult` / `PlanRecord`).
- **Sidebar event shape:** concrete SSE example in `design-context.md` + canonical [`mutation-event.schema.json`](../../schema/contracts/mutation-event.schema.json); mutation REST/SSE routes are mounted on the live Hono server in PR #29.
- **Styling + layout:** design system (RCG-64) + the app-shell layout contract in `design-context.md` (query input + plan area + sidebar).

**Remaining gap for real-data demo:**

1. ✅ **Filled mock data is committed** — Val can build a realistic shell today against `fixtures/mock-plan.json` and `fixtures/mock-mutation-events.json`.
2. **API service implemented in PR #29; merge + manual Clerk smoke remain.** `apps/api` now boots via `npm run dev` / `npm start`, mounts all six plan routes plus `/mutations` + `/mutations/stream`, and talks to Postgres through the verified hero bridge. **Remaining gate:** merge PR #29 and run the manual Clerk bearer curl smoke locally.

**Net:** Val can start and largely finish the shell + sidebar on mocks in two days. What she cannot do alone is show *real* data — that needs Raq's query→plan endpoint by Fri.

---

_Source of truth for status: Linear (RCG) + `main`. This plan supersedes the integration-sprint block in STATUS.md._
