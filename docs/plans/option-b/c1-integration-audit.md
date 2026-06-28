# C1 — Current Runtime Composition Audit (Prompt C, Phase 1)

> Traced from live code at baseline `904e5796d2aba3736f3d731f3a9afcca13a57f93`
> (`chore/option-b-shared-baseline`, PR #47 included). This note records the
> **actual** call chains and composition seams the integration lane builds on.
> It is descriptive of current behavior, not the Option B target.

---

## 1. Current initial Plan flow (`POST /plans`)

```
browser
→ Next.js BFF (apps/web proxy route)
→ Hono route  apps/api/src/plans/routes.ts  app.post("/plans")
     · getAuthenticatedUserId(c)         ← userId resolved by auth middleware, never from body
     · parseQuery(body) / parseCardSlugs(body)  ← 400 on empty query
→ PlanService.createPlan(userId, query, cardSlugs)   [port: plans/service.ts]
→ BridgePlanService.createPlan            apps/api/src/plans/bridge-service.ts
     · execFile(python3, [hero_bridge.py, "create-plan", --user-id, --query, --card-slugs], {env: allowlist, timeout 30s, maxBuffer 16MB, SIGKILL})
     · CLERK_SECRET_KEY is NOT in the allowlist (withheld from the subprocess)
→ hero_bridge.py "create-plan"
→ plan_flows/hero_flow.py  (Python hero generation flow)
→ V31GraphWriteService (schema/mutations.py)  ← canonical transactional boundary
→ psql CLI → PostgreSQL (schema/schema.sql v3.1)
→ bridge prints one JSON envelope line {ok,data|error} on stdout
→ BridgePlanService.fromEnvelope → PlanView  (or PlanServiceError on {ok:false})
→ routes.ts → HTTP 200 PlanView   (PlanServiceError → 400/404/409 via HTTP_STATUS_BY_ERROR_CODE)
```

The TypeScript `Orchestrator` (`apps/api/src/orchestrator/`) **exists but is not
imported by `server.ts`**. It is exercised only by `apps/api/tests/**` against
in-memory doubles. There is no DB and no LLM on that path today.

## 2. Current replan flow (`POST /balance-transfer`)

```
balance transfer (browser → BFF)
→ Hono route  routes.ts  app.post("/balance-transfer")
     · parseTransferInput(body)  ← 400 unless distinct programs + positive safe-int amount
→ PlanService.transferBalance(userId, input)
→ BridgePlanService.transferBalance
     · execFile(python3, [hero_bridge.py, "balance-transfer", --user-id, --source/dest-program-id, --amount, --idempotency-key?])
→ hero_bridge.py "balance-transfer"
→ V31GraphWriteService.transfer_points()  (SQL function)
     · OCC via integer version, pg_advisory_xact_lock per user, idempotency_records keyed by idempotency_key + request_hash
     · stales the dependent plan + steps structurally (state_dependencies edge mismatch)
     · enqueues replan_jobs row
→ synchronous Python replan (inside the same bridge invocation / hero flow)
→ revision promotion (rev N → superseded, rev N+1 → current)
→ JSON envelope → BalanceTransferResult { planLineageId, staledPlanId, replanJobId, currentPlan: PlanView }
```

`transfer_points()`, stale propagation, replan-job creation, idempotency, and
advisory locking are **all Python/SQL-owned** and stay frozen (Option B
re-enters the orchestrator on the changed snapshot; it does not duplicate any of
these).

## 3. Current projection flow (persisted graph → `PlanView`)

There is **no TypeScript projection**. Every `PlanView` is produced by the
Python side: `hero_bridge.py` read subcommands (`get-plan`, `current-plan`)
project `plans` / `plan_steps` / `state_dependencies` rows into the
`PlanView` shape and the bridge returns it as JSON. `BridgePlanService`'s read
methods (`getPlanById`, `getCurrentPlan`) are thin marshallers over those
subcommands. `plans/types.ts` defines the frozen `PlanView` contract the shell
consumes.

For Option B, Contract 7 reuses this Python **projection function** through the
new `PlanProjectionPort` (interface already committed at
`apps/api/src/orchestrator/contracts.ts`) — the Python **plan-generation** flow
is not invoked on that path.

## 4. Current server composition (`apps/api/src/server.ts`)

> **Historical (pre-M5 snapshot).** This table captures `server.ts` *as it was
> at C1 audit time*, before the integration lane landed. The shipped code no
> longer hardcodes `BridgePlanService`: boot now selects the engine once via
> `bootPlanService(process.env, { pool })` (engine assembled in `app.ts`) and
> `/health` returns the selected `engine`. The seams below describe exactly the
> changes that were subsequently made.

| Concern | Wiring at C1 audit time (pre-M5; see note above for shipped state) |
|---|---|
| Env validation | `requireEnv("DATABASE_URL")` only; `CLERK_SECRET_KEY`, `AUTH_DEV_USER_ID`, `CORS_ORIGIN`, `API_PORT` read optionally. **No `PLAN_ENGINE`.** |
| pg Pool | `new Pool({ connectionString: DATABASE_URL })` — shared by auth middleware (clerk_id → user_id lookup) |
| Auth registration | `app.use("*", …)` resolves identity via `resolveIdentity(...)`, sets `userId`/`clerkId`/`email`; dev bypass only when `NODE_ENV !== "production"` |
| Mutation SSE registration | `app.route("/", createMutationRoutes(pool))` |
| Plan service construction | **`const planService = new BridgePlanService();`** (hardcoded — the single seam M5 replaces) |
| Plan route registration | `app.route("/", createPlanRoutes(planService))` |
| Health | `app.get("/health", c => c.json({ ok: true }))` — **no engine field** |
| Startup logging | `console.log("API listening …")` only — no structured boot evidence |

### Seams the integration lane touches
- The `const planService = new BridgePlanService()` line → replaced by an
  engine-selector factory keyed on `PLAN_ENGINE` (M5).
- `/health` → additive `engine` field.
- Startup log → additive safe structured boot evidence (engine + node env
  presence; **no secrets**).

Everything else in `server.ts` (CORS, auth middleware, mutation routes, error
handler, `serve`) is unchanged.

---

## 5. Frozen-doc note (file-path divergence, not a port mismatch)

`orchestrator-thesis-contracts.md §4` and `architecture-option-b.md §7` name the
integration files slightly differently (`plans/orchestrator-service.ts` vs
`plans/orchestrator-plan-service.ts`; whether `agents/registry.ts` is
integration-owned). The **port interfaces are identical** in both docs
(`PlanService`, `GraphSnapshotBuilder`, `Agent`/`AgentRegistry`, `AgentCommit*`,
`OrchestratorGraphWrite`, `PlanProjectionPort`). This is a naming/layout
divergence, not a contract disagreement — resolved by choosing the
contracts-doc names (`plans/engine-selector.ts`, `plans/orchestrator-service.ts`).
The shipped integration uses `plans/orchestrator-service.ts` (not the stale
`orchestrator-plan-service.ts` name), consistent with this resolution.

## 6. Default-engine policy (resolved in favor of frozen contracts)

ADR 0010 §3 and the contracts no-go list require: `PLAN_ENGINE` **unset or
invalid → server fails fast at boot** ("PLAN_ENGINE unset not failing fast at
boot" is listed as *thesis-invalidating*). Prompt C Phase 2's looser phrasing
("python-legacy remains the operational default") is interpreted as the
**recommended explicit value / rollback target**, not an implicit default.
Per AGENTS.md ("locked docs take precedence"), the implementation **fails fast**
and `python-legacy` must be set explicitly. This was a change from the pre-M5
boot behavior (`server.ts` previously booted with no `PLAN_ENGINE`); the shipped
`server.ts` now calls `bootPlanService(process.env, { pool })`, which fails fast
when `PLAN_ENGINE` is unset or invalid. `.env.example` and the Railway notes set
it explicitly so existing local/hosted boots continue to work.
