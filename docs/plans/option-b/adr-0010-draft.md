# ADR 0010 — TypeScript Orchestrator as Canonical Plan/Replan Runtime (Option B)

> **DRAFT — staged in `_bmad-output/`, NOT in `gpFree/docs/adr/`.** This file does
> not modify any canonical ADR or production doc. On ratification (lead sign-off),
> copy verbatim to `gpFree/docs/adr/0010-orchestrator-canonical-runtime.md` and add
> the index row to `gpFree/context/decisions-log.md`. Until then it is a proposal.

- **Status:** Proposed
- **Date:** 2026-06-27
- **Deciders:** Lead (Raq) + team review
- **Supersedes (in part):** D031 — "TS orchestrator/worker remain unmounted target architecture for the Jun-29 demo" — **only for opt-in thesis-verification runs**. D031 remains the stable default for the Jun-29 demo.
- **Relates to:** ADR 0004 (runtime topology), ADR 0005 (plan lineage / replan_jobs), ADR 0007 (contract ownership / codegen), ADR 0001 (schema lock), ADR 0006 (Clerk identity-only), ADR 0008 (per-user serialization / SSE), ADR 0009 (TDD)
- **Evidence base:** `_bmad-output/architecture-recovery-origin-main.md` (pinned `origin/main` @ `206c3d1`); `_bmad-output/architecture-option-b.md`; live contract re-verification 2026-06-27.

---

## Context

On `origin/main`, Plan generation and replanning run in **Python** via
`BridgePlanService` (`apps/api/src/plans/bridge-service.ts`) → `hero_bridge.py` →
`plan_flows/hero_flow.py` + `schema/mutations.py` (`V31GraphWriteService`) over a
`psql` CLI subprocess. This is the **spec-07 "Option B" / decision D031** path: a
consciously-documented deviation taken to hit the Jun-29 demo.

The **TypeScript orchestrator** built under RCG-15
(`apps/api/src/orchestrator/{orchestrator,decomposition,contracts}.ts`,
`apps/api/src/agents/{contracts,ownership}.ts`) **exists but is unmounted** —
`server.ts` imports none of it; `new Orchestrator(...)` appears only in
`apps/api/tests/**`, wired to in-memory fakes (`tests/helpers/*`). There is no
LLM and no DB in that path today.

ADR 0004 always assigned orchestration ownership to the TypeScript `apps/api`
process. The project's thesis is that **agents coordinate only through typed,
schema-validated graph mutations — never free text — and plans survive state
changes structurally.** To *verify that thesis in the running product*, the
orchestrator must conduct real requests against the real persistence boundary.

This ADR promotes ADR 0004's intent to running code **behind an opt-in switch**,
and demotes the Python bridge to an explicit, isolated rollback engine — without
rewriting the working backend or the transactional persistence layer.

## Decision

1. **Option B target.** The TypeScript orchestrator (`Orchestrator` from RCG-15,
   driven by a new `OrchestratorPlanService`) becomes the **canonical runtime for
   Plan generation and replanning** when selected via `PLAN_ENGINE=orchestrator`.
   It is the approved target Plan-generation and replanning runtime.

2. **Relationship to D031.** D031's blessed Python bridge (`BridgePlanService` /
   `hero_bridge.py`) **remains the recommended/rollback engine**, selected by the
   **explicit** value `PLAN_ENGINE=python-legacy`, **until the cutover gates below
   pass.** It is *not* an implicit default: per §3, an unset or invalid
   `PLAN_ENGINE` **fails boot** (fail-fast) — there is no silently-applied engine.
   "Recommended/rollback" means *this is the value operators should set* (and roll
   back to), not that it is chosen automatically. This ADR is a *successor* to
   D031, not a contradiction: D031 = "target unmounted for Jun-29"; ADR 0010 =
   "mount the target for opt-in thesis verification; the bridge becomes the
   explicit rollback engine."

3. **Opt-in thesis-verification mode.** The Jun-29 milestone **may** run in an
   **opt-in** orchestrator thesis-verification mode. Engine selection happens
   **once at boot** from `PLAN_ENGINE`:
   - `orchestrator` → `OrchestratorPlanService` (Option B; thesis-verification path)
   - `python-legacy` → `BridgePlanService` (D031 path; stable default + rollback)
   - unset / any other value → **server FAILS TO BOOT** (fail-fast; no default, no silent choice)
   The active engine is asserted at runtime (logged + reported on `GET /health`)
   so a reviewer can prove orchestrator mode served a given request.

4. **Persistence boundary unchanged.** The existing Python `V31GraphWriteService`
   + SQL functions remain the **canonical transactional persistence boundary**
   (OCC via integer `version`, idempotency via `idempotency_records` inside
   `transfer_points()`, `pg_advisory_xact_lock`, plan lifecycle status
   transitions). The TypeScript commit adapter **does not execute SQL** — it calls
   the controlled write boundary. Invariants 2/3/11/14 of
   `context/architecture-context.md` hold unchanged.

5. **Specialists remain deterministic.** For this milestone the `Decomposer` and
   all specialist adapters are deterministic. No LLM is introduced. This isolates
   the *coordination* variable for the thesis and keeps the path reproducible.

6. **Synchronous replan is allowed.** Replanning may execute synchronously inside
   `POST /balance-transfer` (orchestrator re-entry on the changed snapshot). The
   durable async replan worker (ADR 0005 design) is **deferred**. `replan_jobs`
   remains the durable *lifecycle* table written inside `transfer_points()`.

7. **Token counts are non-blocking.** `agent_runs.token_count` is already nullable
   (`schema/schema.sql`). The deterministic thesis run **must not be blocked** on
   token instrumentation (RCG-53); rows are written without token counts and
   instrumentation lands additively later. No schema change is required.

8. **No silent fallback (hard requirement).** If `OrchestratorPlanService` raises,
   the request returns a **typed error** mapped to the existing HTTP status codes.
   It must **never** transparently retry through `BridgePlanService`. Rollback is a
   deliberate boot-time switch, never an automatic per-request fallback.

9. **Contracts stay stable.** Public HTTP contracts (`PlanView`,
   `PlanStepView`, `SessionView`, `BalanceTransferInput`, `BalanceTransferResult`,
   the `PlanService` port, all routes) remain unchanged across both engines.
   Changing a public contract requires a *demonstrated blocker* recorded here;
   none is currently identified. `GET /health` gains an engine field (additive).

10. **PR #50 sequencing.** PR #50 (`fix/backend-seed-data-flow`) **must land
    before** any conflicting `context/architecture-context.md` edits and before any
    *deployed* orchestrator run (it provisions schema/seed at boot via
    `scripts/ensure_schema_seed.py` and installs the "current vs target" framing
    this ADR builds on). Post-merge context-doc edits must keep
    `tests/test_runtime_architecture_docs.py` green.

## Cutover gates (all must pass before `orchestrator` becomes the default)

- **G1 — Plan parity.** For the frozen demo fixture, `POST /plans` produces an
  equivalent `PlanView` shape under `orchestrator` and `python-legacy`
  (golden-output comparison).
- **G2 — Two distinct specialists.** `agent_runs` shows ≥2 rows with distinct
  `agent_type` for a single orchestrator-built plan.
- **G3 — Boundary integrity.** Only the controlled commit adapter (M3) calls the
  write service from TypeScript; grep shows zero other TS write seams; an
  unowned/invalid mutation is rejected with **zero** DB rows written.
- **G4 — Structural invalidation + replan.** A balance transfer stales exactly the
  dependent plan + steps in one transaction; the orchestrator re-enters on the
  changed snapshot; rev 1 → `superseded`, rev 2 → `current` (one current per
  lineage).
- **G5 — No fallback proof.** With `PLAN_ENGINE=orchestrator`, logs confirm the
  bridge was never invoked; `GET /health` reports `orchestrator`; an orchestrator
  failure surfaces as a typed error (no bridge retry).
- **G6 — Real-JWT browser run.** Thesis DoD passes in a browser with a real Clerk
  token (not `AUTH_DEV_USER_ID`), no fixtures, no fallback.
- **G7 — Two consecutive green runs** under `orchestrator` before legacy removal is
  even considered (see Rollback / Removal).

## Rollback behavior

- **Trigger:** any thesis-verification failure or production incident under
  `orchestrator`.
- **Action:** set `PLAN_ENGINE=python-legacy` and restart (boot-time switch only).
- **Guarantees:** identical schema and row shapes — both engines write through
  `V31GraphWriteService` / `transfer_points()`, so `plans` / `plan_steps` /
  `state_dependencies` / `graph_mutations` rows are identical in shape and
  lifecycle. A plan created under one engine is readable and replannable under the
  other. **No code revert, no data migration.**
- **Non-guarantee:** the legacy engine does not populate `agent_runs`;
  observability for legacy-created plans is via `graph_mutations` only. Acceptable —
  rollback is a safety valve, not the thesis path.
- **Forbidden:** automatic per-request fallback (would invalidate the thesis and
  mask failures).

## Deferred production work (explicitly NOT in this milestone)

- Durable asynchronous replan worker + lease semantics (ADR 0005) — sync allowed.
- Independent agent services / OS-process isolation (ADR 0007 production control) —
  in-process typed adapters only.
- Message broker / external queue — out of MVP (ADR 0004).
- Full generalized `graph/read/` query layer — the PG-backed snapshot adapter +
  existing plan projection suffice.
- Complete legacy-engine removal — gated on two green thesis runs + benchmark
  numbers (RCG-37) captured under `orchestrator` + team sign-off.
- LLM-backed `Decomposer` / specialists — pending reasoning-engine equalization
  (RCG-69, an eval concern, not an Option B runtime component).
- Token-count instrumentation on `agent_runs` (RCG-53) — additive, non-blocking.
- `apps/web/` migration (ADR 0004 amended) — web deploys from repo root.
- Multi-tenant hardening beyond the single seeded persona (ADR 0006).

## Consequences

- **New components (all NEW; none claimed implemented):** PG-backed snapshot
  adapter (M1), typed specialist adapters wrapping pure logic (M2), controlled
  TS→Python graph-write commit adapter (M3), `agent_runs` lifecycle repository
  (M4), `PLAN_ENGINE` selector (M5), `OrchestratorPlanService` (M6), runtime
  contract validation (M7), error taxonomy (M8), observability (M9). Exact
  contracts: `_bmad-output/orchestrator-thesis-contracts.md`.
- `agent_runs` becomes live (it is DDL-only today).
- Rollback is a boot-time switch with no data migration.
- D031 stands for the Jun-29 demo default; ADR 0010 governs the opt-in thesis run
  and any later promotion to default once the gates pass.

## Verdict

**Decisions resolved** (the four open items in `architecture-option-b.md §19` are
fixed by this ADR): milestone timing (opt-in, D031 stays default), deterministic
reasoning engine, `agent_runs.token_count` non-blocking (nullable, no schema
change), PR #50 merges before context-doc edits. No item requires redesign.
