# Option B — Architecture Reference (Implementation Lanes)

> Companion to `adr-0010-orchestrator-canonical-runtime-DRAFT.md` (decisions) and
> `orchestrator-thesis-contracts.md` (port contracts + fixture). This file covers
> as-built vs target, post-PR #47 collision map, branch topology, and validation.
>
> Baseline SHA: `chore/option-b-shared-baseline` — see §5 for exact SHA.

---

## 1. As-Built Runtime (origin/main @ 3ed4eeb, post-PR #47)

```
POST /plans
  └─ BridgePlanService (apps/api/src/plans/bridge-service.ts)
       └─ execFile(pythonBin, ['hero_bridge.py', 'create-plan', ...])
            └─ hero_flow.py → V31GraphWriteService (schema/mutations.py)
                 └─ psql → PostgreSQL (schema/schema.sql v3.1)

POST /balance-transfer
  └─ BridgePlanService.replan()
       └─ execFile(pythonBin, ['hero_bridge.py', 'balance-transfer', ...])
            └─ hero_flow.py → V31GraphWriteService (same boundary)
```

TypeScript orchestrator (`apps/api/src/orchestrator/`): **exists, unmounted**.
`server.ts` does not import it. All tests use in-memory fakes only.

---

## 2. Option B Target Runtime (opt-in via PLAN_ENGINE=orchestrator)

```
POST /plans
  └─ OrchestratorPlanService (M6 — NEW, not yet implemented)
       └─ Orchestrator.run(PlanRequest)
            ├─ M1 PgSnapshotAdapter     → PostgreSQL (read-only snapshot)
            ├─ M2 WalletAdapter         → wallet_agent (pure TS logic)
            ├─ M2 RedemptionAdapter     → redemption_agent (pure TS logic)
            ├─ M3 ControlledCommitAdapter → hero_bridge.py subcommands (additive)
            │      └─ V31GraphWriteService → PostgreSQL (write boundary UNCHANGED)
            └─ M4 AgentRunRepository    → agent_runs table (DDL-only today, goes live)
       └─ M7 runtime validation of PlanResult before HTTP response
       └─ PlanProjectionPort.project() → hero_bridge.py read subcommand → PlanView

POST /balance-transfer
  └─ BridgePlanService (unchanged — transfer_points() stays Python-owned)
       └─ OrchestratorPlanService.replan() (M6) triggered on stale plan
```

**What does NOT change:** `V31GraphWriteService`, `schema/schema.sql`, all HTTP
routes/contracts (`PlanView`, `PlanStepView`, `SessionView`), `GET /health` format
(additive `engine` field only), `plans`/`plan_steps`/`state_dependencies` row shapes.

---

## 3. Specialist Choice — Wallet + Redemption

Evidence from `apps/api/src/agents/ownership.ts`:

```ts
MUTATION_OWNERSHIP = {
  wallet_agent:     ["UpdateUserBalance"],
  earning_agent:    ["CreatePlanStep"],
  redemption_agent: ["CreatePlanStep", "RecordStateDependency"],
}
```

`RecordStateDependency` is the only mechanism that makes a balance transfer
structurally stale a plan. `redemption_agent` is its sole owner. Earning is
excluded: it writes `CreatePlanStep` but no dependency — a stale earning plan
cannot be detected structurally. **Wallet + Redemption is the minimum two-
specialist pair that proves the thesis.**

---

## 4. Demo Fixture — Exact Numbers (fixtures/demo-seed.json + person-c-hyatt-direct-seed.json)

| Field | Value |
|---|---|
| User ID | `00000000-0000-0000-0000-00000000a001` |
| Clerk ID | `clerk_hero_demo` |
| Chase UR balance (initial) | **180,000 points** (program `b001`) |
| Hyatt balance (initial) | **30,000 points** (program `b002`) |
| Transfer ratio Chase → Hyatt | 1:1 (10,000 basis points) |
| Demo transfer amount | **30,000 Chase UR → Hyatt** |

**Award thresholds (from person-c-hyatt-direct-seed.json):**

| Award slug | Points required |
|---|---|
| `award:demo_hyatt_ueno:tokyo:3n` | 24,000 |
| `award:demo_hyatt_shinjuku:tokyo:3n` | 30,000 |
| `award:demo_hyatt_ginza:tokyo:3n` | **45,000** |

**Rev 1 plan** (Chase UR = 180k, Hyatt = 30k):
- Wallet: Chase UR = 180k available for transfer
- Redemption: Hyatt = 30k → below Ginza threshold (45k); plan includes transfer step
  (transfer 30k Chase UR → Hyatt) + `RecordStateDependency` on Chase UR balance
- Expected steps: `[assess_wallet, transfer_chase_to_hyatt, redeem_hyatt_ginza]`

**Thesis trigger:** `POST /balance-transfer` executes the 30k transfer:
- Chase UR: 180k → **150k**
- Hyatt: 30k → **60k**
- `RecordStateDependency` fires → plan step staled → orchestrator re-enters on changed snapshot

**Rev 2 plan** (Chase UR = 150k, Hyatt = 60k):
- Hyatt = 60k ≥ 45k → direct redemption, no transfer step needed
- Expected: `revisionNumber` increments, transfer step absent, rev 1 → `superseded`

---

## 5. Branch Topology

```
origin/main @ 3ed4eeb
    └── chore/option-b-shared-baseline @ <baseline-SHA>
            ├── feat/orchestrator-production-adapters   (Prompt B)
            ├── feat/orchestrator-thesis-integration    (Prompt C)
            ├── feat/orchestrator-observability         (Observability UI)
            └── test/orchestrator-thesis-verification   (Verification harness)
```

All four implementation branches start from the same baseline SHA.

---

## 6. Post-PR #47 Collision Map

PR #47 merged 2026-06-27. Updated ownership per current `origin/main`:

| File | PR #47 change | Option B touch | Owner | Risk |
|---|---|---|---|---|
| `apps/api/src/server.ts` | Formatting only (console.warn) | Prompt C adds PLAN_ENGINE selector | Prompt C | **NONE** — formatting change is safe base |
| `apps/api/src/plans/routes.ts` | cardSlugs trimming | No Option B change | None (frozen) | None |
| `apps/api/src/plans/bridge-service.ts` | cardSlugs forwarding | No Option B change | Rollback engine | None |
| `apps/api/src/plans/service.ts` | Formatting only | Frozen (PlanService port) | None | None |
| `apps/api/src/orchestrator/contracts.ts` | Not touched by PR #47 | Baseline adds `PlanProjectionPort` | Both lanes import | SHARED — read-only after baseline |
| `apps/api/src/agents/contracts.ts` | Not touched | FROZEN | Neither lane | None |
| `apps/api/src/agents/ownership.ts` | Not touched | FROZEN | Neither lane | None |
| `apps/api/bridge/hero_bridge.py` | Not touched by PR #47 | Prompt B adds subcommands additively | Prompt B | Low — additive only |
| `plan_flows/hero_flow.py` | Not touched | No Option B change | Legacy engine | None |
| `agents/redemption/planner.py` | Fixed unsupported-query bypass | No Option B change | Legacy engine | None |
| `components/onboarding/AgentConsole.tsx` | Major rewrite (PR #47) | Observability lane | Observability | Isolated |
| `lib/api/adapters.ts` | nodeId assignment | Observability lane | Observability | Isolated |
| `AI_USAGE.md` | Reformatted tables | Option B adds entry | All lanes | Low — append-only |
| `apps/api/tests/**` | Not touched | Both lanes add tests | Per-lane | None |

**Single-file collision after PR #47: zero.** `server.ts` is the only file both
Prompt C and PR #47 touched, and PR #47's change was pure formatting — no logic
conflict exists.

---

## 7. Implementation Lane Ownership

### Prompt B — `feat/orchestrator-production-adapters`

**Owns exclusively:**
- `apps/api/src/orchestrator/snapshot.ts` (M1 — NEW)
- `apps/api/src/orchestrator/adapters/wallet.ts` (M2 — NEW)
- `apps/api/src/orchestrator/adapters/redemption.ts` (M2 — NEW)
- `apps/api/src/orchestrator/commit-adapter.ts` (M3 — NEW)
- `apps/api/src/orchestrator/agent-run-repository.ts` (M4 — NEW)
- `apps/api/src/orchestrator/validation.ts` (M7 — NEW)
- `apps/api/src/orchestrator/errors.ts` (M8 — NEW)
- `apps/api/src/orchestrator/observability.ts` (M9 — NEW)
- `apps/api/src/orchestrator/plan-projection.ts` (Contract 7 impl — NEW)
- `apps/api/bridge/hero_bridge.py` (additive subcommands only)
- All adapter tests under `apps/api/tests/orchestrator/`

**Must NOT touch:** `apps/api/src/server.ts`, `apps/api/src/plans/routes.ts`,
`apps/api/src/plans/service.ts`, `apps/api/src/plans/bridge-service.ts`.

### Prompt C — `feat/orchestrator-thesis-integration`

**Owns exclusively:**
- `apps/api/src/plans/orchestrator-plan-service.ts` (M6 — NEW)
- `apps/api/src/server.ts` (M5 PLAN_ENGINE selector — one edit)
- Integration tests: `apps/api/tests/integration/orchestrator-e2e.test.ts`

**Must NOT touch:** hero_bridge.py, adapter files, Python boundary.
**Merges after Prompt B.**

### Observability lane — `feat/orchestrator-observability`

**Owns exclusively:** frontend mutation/plan components only.
**No backend contract changes.**

### Verification lane — `test/orchestrator-thesis-verification`

**Owns exclusively:** harness scripts, runbook, evidence capture.
**No production implementation.**

---

## 8. Validation Gate Matrix

| Gate | Command | Baseline result |
|---|---|---|
| API typecheck | `npm --prefix apps/api run typecheck` | ✓ exit 0 |
| API tests | `npm --prefix apps/api test` | ✓ 89 passed |
| Web tests | `npm test` | ✓ 154 passed |
| Python tests | `python3 -m unittest discover -v` | ✓ 168 passed, 10 skipped |
| Web typecheck | `npm run typecheck` | ⚠ 2 pre-existing warnings (unused @ts-expect-error in lib/cards/repository.ts:144 and lib/user/repository.ts:153 — local pg env artifact; CI green) |
| Web build | `npm run build` | ⚠ fails locally (same pg env artifact); CI web-build ✓ |
| Secret scan | grep on docs/plans/option-b/ | ✓ no real secrets |
| Direct Hyatt test | `python3 -m unittest tests.redemption.test_planner -v` | ✓ included in Python run |
| Coverage gate | CI enforces 100% diff coverage | ✓ enforced per AGENTS.md |

**Pre-existing web issues:** Two `@ts-expect-error` directives in `lib/cards/repository.ts:144`
and `lib/user/repository.ts:153` are unused locally because the local Node environment
can resolve `pg`. CI uses `npm ci` (no root-level `pg`) so the directives remain valid
in CI and `web-build` is green. These are not introduced by the Option B baseline.

---

## 9. No-Go Conditions

Implementation must HALT and escalate if any of the following occur:

1. A specialist adapter reaches `PostgreSQL` directly (bypasses `V31GraphWriteService`)
2. `server.ts` imports an orchestrator component without `PLAN_ENGINE` gating
3. `OrchestratorPlanService` silently catches and retries through `BridgePlanService`
4. A new `GraphMutation` type appears outside `schema/mutations.py` definitions
5. `AgentContext` gains a `queryText`/`message`/`PlanProjectionPort` field (free-text channel)
6. Any test is weakened or removed to make the baseline green
7. `plan_steps.status` or `plans.status` transitions are handled outside `V31GraphWriteService`
