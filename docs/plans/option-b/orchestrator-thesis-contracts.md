---
title: "Orchestrator Thesis-Verification — Frozen Implementation Contracts (Option B)"
project: "GpFree — Rewards Agent (Typed-Graph Multi-Agent Coordination)"
author: "Raq (facilitated)"
date: "2026-06-27"
status: "CONTRACTS READY"
evidence_pinned_commit: "origin/main @ 206c3d1 (recovery); TS/Python contracts re-verified at HEAD of fix/planview-typed-graph 2026-06-27"
authoritative_inputs:
  - "_bmad-output/project-context.md"
  - "_bmad-output/architecture-recovery-origin-main.md"
  - "_bmad-output/spec-drift-architecture-context.md"
  - "_bmad-output/architecture-option-b.md"
  - "_bmad-output/adr-0010-orchestrator-canonical-runtime-DRAFT.md"
  - "gpFree/apps/api/src/{plans,orchestrator,agents}/*.ts (live types)"
  - "gpFree/apps/api/tests/helpers/*.ts (current test doubles)"
  - "gpFree/schema/{mutations.py,schema.sql}, gpFree/plan_flows/hero_flow.py"
  - "gpFree/fixtures/demo-seed.json (seed source of truth)"
scope:
  - "Freeze the exact seams an integration branch and a production-adapter branch build against."
  - "No production runtime code is written here. No Linear, ADR, or canonical doc is modified."
constraints_honored:
  - "Does NOT claim any Option B target component is mounted (all M1–M9 are NEW/proposed)."
  - "No async worker, no broker, no persistence rewrite in TypeScript."
---

# Orchestrator Thesis-Verification — Frozen Implementation Contracts

> Companion to `adr-0010-orchestrator-canonical-runtime-DRAFT.md`. This document
> freezes the **seven seams** that the thesis-verification milestone is built
> against, selects the **smallest two-specialist flow** that proves the hypothesis,
> pins **one exact demo fixture**, and partitions the work into **two parallel
> branches** with minimized file overlap.
>
> **Source-of-truth rule:** every TypeScript type below is copied from live code on
> `gpFree/apps/api/src/**` and every Python shape from `gpFree/schema/mutations.py`.
> Where a type is reproduced for readability, the file is cited; on any divergence,
> **the code wins** and this doc is corrected.

---

## 0. Component legend (from ADR 0010 / architecture-option-b §3.1)

| ID | Component | State today | Owner branch |
|---|---|---|---|
| M1 | PG-backed `GraphSnapshotBuilder` adapter | NEW | production-adapter |
| M2 | Typed specialist adapters (wallet, redemption) | NEW (wallet ↔ RCG-16) | production-adapter |
| M3 | Controlled TS→Python graph-write commit adapter | NEW | production-adapter |
| M4 | `agent_runs` lifecycle repository | NEW | production-adapter |
| M5 | `PLAN_ENGINE` selector (fail-fast, no fallback) | NEW | integration |
| M6 | `OrchestratorPlanService` (`PlanService` impl) | NEW | integration |
| M7 | Runtime contract validation (3 boundaries) | partial (`validateDecomposedQuery` exists) | production-adapter |
| M8 | Error taxonomy | partial (`OrchestrationError` / `CommitFailure` exist) | production-adapter |
| M9 | Observability (`agent_runs` rows; tokens deferred) | NEW | production-adapter |

`Orchestrator` core + `Decomposer` + `validateDecomposedQuery` already exist and
are **frozen** — Option B mounts them, it does not rewrite them.

---

## 1. The seven contracts

Each contract states: **exact TS type / schema · validation owner · failure
semantics · idempotency responsibility · user-scoping requirement · production
implementation · current test double · likely repository touch areas.**

---

### Contract 1 — Plan service → orchestrator

The HTTP layer talks to one engine-agnostic port. Option B adds a second
implementation that drives the mounted `Orchestrator`.

**Exact TS type** (`apps/api/src/plans/service.ts`, `apps/api/src/orchestrator/contracts.ts`):

```ts
// FROZEN — the port routes already bind (createPlanRoutes(service)).
export interface PlanService {
  getSession(identity: SessionIdentity): Promise<SessionView>;
  resetDemo(userId: string): Promise<SessionView>;
  createPlan(userId: string, query: string, cardSlugs?: string[]): Promise<PlanView>;
  getPlanById(userId: string, planId: string): Promise<PlanView | null>;
  getCurrentPlan(userId: string, lineageId: string): Promise<PlanView | null>;
  transferBalance(userId: string, input: BalanceTransferInput): Promise<BalanceTransferResult>;
}

// The orchestrator core speaks its own request/result; M6 ADAPTS between them.
export interface PlanRequest { readonly userId: string; readonly queryText: string; }
export interface PlanResult {
  readonly planId: string;
  readonly planLineageId: string;
  readonly status: "current" | "failed";
  readonly agentRunIds: readonly string[];
}
```

> **Load-bearing adaptation gap:** `Orchestrator.run()` returns `PlanResult` (IDs +
> status), but `PlanService.createPlan` must return a full `PlanView`. **M6 owns the
> `PlanResult → PlanView` re-projection** (Contract 7). The four read methods
> (`getSession`/`getPlanById`/`getCurrentPlan`/`resetDemo`) are engine-agnostic and
> reuse the existing projection regardless of engine.

- **Validation owner:** Hono route handlers (`plans/routes.ts`) validate the HTTP
  body (400 empty query; 401 unauth) **before** calling the port. The port never
  re-validates HTTP shape.
- **Failure semantics:** the port raises `PlanServiceError("validation" | "not_found" | "conflict", msg)`; `routes.ts` is the only layer mapping those to 400/404/409. Orchestrator-internal failures (`OrchestrationError`, `CommitFailure`) are translated **inside M6** into `PlanServiceError` (Contract 8). **No fallback to `BridgePlanService`** (ADR 0010 §8).
- **Idempotency responsibility:** `createPlan` is **not** idempotent at this seam (each call mints a new `planLineageId` in `Orchestrator.run`). `transferBalance` idempotency is delegated downstream to `transfer_points()` via `BalanceTransferInput.idempotencyKey` (Contract 6).
- **User-scoping:** `userId` is resolved by Hono middleware (`http/auth.ts` → `c.set("userId")`) and passed as the **first argument** to every method. The port implementations must treat `userId` as the hard tenancy boundary; no method derives identity from the body.
- **Production implementation:** M6 `OrchestratorPlanService` (NEW) for `orchestrator`; `BridgePlanService` (LIVE, unchanged) for `python-legacy`. Selection by M5.
- **Current test double:** `apps/api/tests/helpers/*` drive `Orchestrator` directly; there is **no** `PlanService`-level fake for the orchestrator path yet (routes are tested today against `BridgePlanService` semantics in `plans/routes.test.ts`).
- **Likely repository touch areas:** `apps/api/src/plans/orchestrator-service.ts` (NEW M6); `apps/api/src/server.ts` (M5 factory at the `const planService = …` seam, currently `server.ts:` hardcodes `new BridgePlanService()`); `apps/api/tests/plans/orchestrator-service.test.ts` (NEW).

---

### Contract 2 — Orchestrator → snapshot port

The orchestrator hands each specialist a **read-only** snapshot of the user's
committed graph. Option B swaps the stub for a PostgreSQL-backed adapter (M1).

**Exact TS type** (`apps/api/src/agents/contracts.ts`):

```ts
export interface GraphSnapshotBuilder {
  build(input: { userId: string; planId: string }): Promise<GraphSnapshot>;
}

export type GraphSnapshot = Readonly<{
  userBalances: ReadonlyArray<UserBalanceRow>;          // {id, programId, balancePoints, version}
  userGoals: ReadonlyArray<UserGoalRow>;                // {id, goalType, targetRedemptionOptionId}
  userProgramStatuses: ReadonlyArray<UserProgramStatusRow>; // {id, programId, statusTier, version}
}>;
```

- **Validation owner:** M1 owns shape conformance of rows it reads from Postgres (M7 may assert the snapshot is well-formed before the loop). The `Readonly`/`ReadonlyArray` typing is a **compile-time** write barrier — specialists cannot mutate the snapshot (thesis claim 3).
- **Failure semantics:** a build failure (DB unreachable, row malformed) throws; `Orchestrator.run` catches it in the per-invocation `try` as an **`infrastructure`** failure, finalizes the AgentRun `failed`, transitions the plan `failed`, returns `PlanResult{status:"failed"}`. No partial snapshot is ever handed to an agent.
- **Idempotency responsibility:** none — `build` is a pure read; it is re-invoked **once per agent invocation** (`orchestrator.ts` calls `snapshotBuilder.build` inside the loop), so agent N observes agent N-1's committed mutations (thesis claim 8). M1 must read **committed** rows (no read of in-flight writes).
- **User-scoping:** `build({userId, planId})` MUST filter every query by `user_id = $userId`. The snapshot must never contain another user's balances/goals/statuses. World/reference data (programs, redemption options) is shared and read separately by specialists via their operation IDs, not via the snapshot.
- **Production implementation:** M1 PG-backed `GraphSnapshotBuilder` reading `user_balances`, `user_goals`, `user_program_statuses` for `userId`. Reuses the Hono `pg` Pool already constructed in `server.ts` (read-only; no `psql` subprocess needed for reads).
- **Current test double:** `apps/api/tests/helpers/stub-snapshot-builder.ts` (`StubGraphSnapshotBuilder`, constant `tokyoSnapshot`; `setThrowOnBuild()` for failure injection).
- **Likely repository touch areas:** `apps/api/src/agents/snapshot/pg-snapshot-builder.ts` (NEW M1); `apps/api/src/agents/snapshot/pg-snapshot-builder.test.ts` (NEW, live-PG gated by `RUN_LIVE_POSTGRES_TESTS=1`). **No SQL writes** — read-only.

---

### Contract 3 — Orchestrator → specialist launcher

The orchestrator selects and runs specialists from a typed registry. Each agent
receives **only** typed `operation` + `snapshot` + `commit` — never `queryText`,
never another agent's output, never free text (thesis claim 4).

**Exact TS type** (`apps/api/src/agents/contracts.ts`):

```ts
export type SpecialistAgentType = "wallet_agent" | "earning_agent" | "redemption_agent";

export interface AgentContext<K extends SpecialistAgentType> {
  readonly planId: string;
  readonly userId: string;
  readonly agentRunId: string;
  readonly operation: OperationByAgent[K];   // typed per agent; no queryText/message field exists
  readonly snapshot: GraphSnapshot;          // read-only (Contract 2)
  readonly commit: AgentCommit;              // the ONLY write capability (Contract 4)
}

export interface Agent<K extends SpecialistAgentType> {
  readonly agentType: K;
  run(context: AgentContext<K>): Promise<void>;
}

export type AgentRegistry = { readonly [K in SpecialistAgentType]: Agent<K> };
```

- **Validation owner:** `Decomposer` output is validated by `validateDecomposedQuery` (`orchestrator/decomposition.ts`) **before** any agent runs — unknown `agentType`, extra keys, kind/agentType mismatch all throw `OrchestrationError("DecompositionInvalid")` and the plan fails with **zero** AgentRuns. Agents trust the typed `operation` they receive.
- **Failure semantics:** an agent that throws halts the sequence (`orchestrator.ts` `dispatch` failure → `failInvocation(failureKind:"agent")`): the failing AgentRun is finalized `failed`, the plan transitions `failed`, remaining invocations do **not** run (no partial silent skip). The agent's `run` returns `Promise<void>` — success is "did not throw and `commit` resolved."
- **Idempotency responsibility:** the agent constructs a deterministic `idempotencyKey` per commit (test doubles use `` `${ctx.agentRunId}:${n}` ``); replay safety is enforced downstream (Contract 4 / Contract 6), not by the launcher.
- **User-scoping:** the agent never reads `userId` to query the DB (it has no DB handle). `userId` is carried for the commit binding and AgentRun attribution only. Boundary: an agent has **no** `db`, `graphWrite`, `http`, or `message` field by type (thesis claim 5).
- **Production implementation:** M2 typed adapters for the selected pair (`wallet_agent`, `redemption_agent`), each wrapping pure deterministic logic. `earning_agent` is **out of the thesis flow** for this milestone (see §2) but the registry type still requires all three keys — supply a minimal conformant `earning_agent` adapter or a deterministic stub that is never invoked by the chosen decomposition.
- **Current test double:** `apps/api/tests/helpers/fake-agents.ts` (`FakeWalletAgent`, `FakeRedemptionAgent`, `FakeEarningAgent`, plus adversarial doubles `WalletAgentSubmittingDependency`, `SpecialistNamingPlanCommand`, `FailingEarningAgent`).
- **Likely repository touch areas:** `apps/api/src/agents/wallet/wallet-agent.ts` (NEW M2; extends RCG-16), `apps/api/src/agents/redemption/redemption-agent.ts` (NEW M2), `apps/api/src/agents/registry.ts` (NEW — assembles `AgentRegistry`), co-located `*.test.ts`. **Must not** import `lib/`, `app/`, or any DB client.

---

### Contract 4 — Orchestrator → commit port

`commit` is the **single write capability** a specialist holds. The commit adapter
(M3) is the gatekeeper: it validates, checks ownership, then delegates to the
Python write boundary (Contract 6).

**Exact TS type** (`apps/api/src/agents/contracts.ts`):

```ts
export type AgentCommit = (input: AgentCommitInput) => Promise<CommitSuccess>;

export interface AgentCommitInput {
  readonly mutation: SpecialistMutation;   // UpdateUserBalance | CreatePlanStep | RecordStateDependency
  readonly readSet: ReadSet;               // Readonly<Record<nodeId, observedVersion>>
  readonly idempotencyKey: string;
}
export interface CommitSuccess { readonly mutationTxnId: string; readonly idempotencyReplayed: boolean; }

export interface AgentCommitFactory { create(binding: AgentCommitBinding): AgentCommit; }
export interface AgentCommitBinding {
  readonly userId: string; readonly planId: string;
  readonly agentRunId: string; readonly agentType: SpecialistAgentType;
}

export type CommitFailureKind =
  | "ValidationError" | "OwnershipError" | "ConflictError"
  | "IdempotencyConflict" | "UnexpectedCommitError";
export class CommitFailure extends Error {
  constructor(
    readonly kind: CommitFailureKind,
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {}
}
```

- **Validation owner:** M3 (the commit adapter), in this exact order, **before** any DB write: (1) `idempotencyKey` non-empty; (2) `readSet` well-formed (`validateReadSet`); (3) mutation structure (`validateMutationStructure`); (4) **ownership** via `isOwnedBy(agentType, mutation.kind)` (`agents/ownership.ts`); (5) `CreatePlanStep.planId === binding.planId`. This is the runtime half of M7.
- **Failure semantics:** typed `CommitFailure` per failing check (`ValidationError` / `OwnershipError` / `IdempotencyConflict` / `ConflictError` on OCC stale / `UnexpectedCommitError`). On failure **zero DB rows** are written (thesis claim 6). The agent's `run` rejects → orchestrator halts the sequence.
- **Idempotency responsibility:** **M3 owns the TS-side idempotency contract.** Same `idempotencyKey` + identical mutation fingerprint → return prior `CommitSuccess` with `idempotencyReplayed:true`; same key + **different** fingerprint → `CommitFailure("IdempotencyConflict")`. (The in-memory double already implements this via `stableFingerprint`.) For balance writes that reach `transfer_points()`, the SQL `idempotency_records` table is the durable authority; M3's key maps to `request_hash` (Contract 6).
- **User-scoping:** the commit is bound to `{userId, planId, agentRunId, agentType}` at factory time; the agent cannot widen it. M3 must assert the mutation's target rows belong to `binding.userId` before delegating (a balance node id must resolve to that user).
- **Production implementation:** M3 `ControlledGraphWriteCommit` + `AgentCommitFactory`, delegating to Contract 6.
- **Current test double:** `apps/api/tests/helpers/in-memory-commit.ts` (`InMemoryAgentCommitFactory` — full validation + ownership + idempotency + checkpoint merge; `ThrowingCommitFactory` for factory-failure injection).
- **Likely repository touch areas:** `apps/api/src/agents/commit/controlled-commit.ts` (NEW M3), `apps/api/src/agents/commit/controlled-commit.test.ts` (NEW). Reuses `agents/ownership.ts` (FROZEN) and the validation helpers (port from `in-memory-commit.ts` into a shared, production-grade module — **the one place** ownership/validation logic should live so the double and the real adapter cannot drift).

---

### Contract 5 — Orchestrator → AgentRun lifecycle

The orchestrator opens and closes an `agent_runs` row per invocation; this is the
observability spine (thesis claims 2, 13).

**Exact TS type** (`apps/api/src/orchestrator/contracts.ts`):

```ts
export interface OrchestratorGraphWrite {
  createPlan(input: { userId: string; planLineageId: string; queryText: string }): Promise<PlanRecord>;
  transitionPlanStatus(input: { planId: string; toStatus: "current" | "failed" }): Promise<void>;
  createAgentRun(input: { planId: string; userId: string; agentType: AgentType }): Promise<AgentRunRecord>;
  finalizeAgentRun(input: { agentRunId: string; status: "completed" | "failed"; error?: string }): Promise<void>;
}

export interface AgentRunRecord {
  readonly id: string; readonly agentType: AgentType; readonly planId: string; readonly userId: string;
  readonly status: "running" | "completed" | "failed";
  readonly state: { last_read_versions: Record<string, number> } | null;
  readonly error: string | null;
}
```

**Backing DDL** (`schema/schema.sql`, table FROZEN, additive-only per ADR 0001):

```sql
CREATE TABLE agent_runs (
  id UUID PK, agent_type TEXT, plan_id UUID NULL REFERENCES plans(id),
  user_id UUID NOT NULL REFERENCES users(id), started_at, completed_at,
  status TEXT DEFAULT 'running', state JSONB NULL,
  token_count INTEGER NULL,                 -- NULLABLE → token instrumentation never blocks the run
  error TEXT NULL, graph_tier 'plan', node_type 'AgentRun', version INTEGER DEFAULT 0, ...
  CHECK agent_type IN ('orchestrator','wallet_agent','earning_agent','redemption_agent'),
  CHECK status IN ('running','completed','failed','timed_out'));
```

- **Validation owner:** M4 maps the TS record to the DDL and enforces the `agent_type` / `status` CHECK domains before insert/update.
- **Failure semantics:** a `createAgentRun` failure is an `infrastructure` failure in `orchestrator.ts`; a `finalizeAgentRun(completed)` failure is a `lifecycle_persistence` failure — both route through `failInvocation`, which itself best-effort finalizes `failed` and records `cleanupErrors`. If `transitionPlanStatus(failed)` also fails, the orchestrator throws a hard `Error` (no silent swallow).
- **Idempotency responsibility:** none required for the demo — each invocation creates exactly one run; the orchestrator never retries `createAgentRun`. (`token_count` is left `NULL`; populating it later, RCG-53, is additive and must not gate the run.)
- **User-scoping:** every row carries `user_id`; M4 sets it from the orchestrator's `userId` (never from agent output). Reads of `agent_runs` for verification filter by `user_id` + `plan_id`.
- **Production implementation:** M4 `AgentRunRepository` implementing the `createAgentRun`/`finalizeAgentRun` slice of `OrchestratorGraphWrite`, plus `createPlan`/`transitionPlanStatus` delegating to Contract 6 (these are *plan-lifecycle* writes, owned by the Python boundary).
- **Current test double:** `apps/api/tests/helpers/in-memory-graph-write.ts` (`InMemoryOrchestratorGraphWrite` — Maps for `plans`/`agentRuns`, `commandCounts`, `mergeReadCheckpoint`, throw-injectors, and the `plans_one_current_revision` invariant emulation).
- **Likely repository touch areas:** `apps/api/src/orchestrator/graph-write/agent-run-repository.ts` (NEW M4), `.../graph-write/orchestrator-graph-write.ts` (NEW — assembles the full `OrchestratorGraphWrite` from M3 + M4), co-located live-PG tests. `agent_runs` already exists in `schema/schema.sql` — **no DDL change.**

---

### Contract 6 — Commit adapter → Python graph-write boundary

The single TS→persistence seam. M3 does **not** execute SQL; it calls the existing
Python `V31GraphWriteService` (the canonical transactional boundary, unchanged).

**Exact Python request shapes** (`schema/mutations.py`, FROZEN dataclasses):

```python
@dataclass(frozen=True)
class CreatePlanRequest:        # ← TS CreatePlan (orchestrator-owned)
  actor: str; user_id: str; plan_lineage_id: str; revision_number: int
  query_text: str; status: str = "generating"; plan_type: str = "agent_generated"; summary: Optional[str] = None ...

@dataclass(frozen=True)
class CreatePlanStepRequest:    # ← TS SpecialistMutation kind="CreatePlanStep"
  actor: str; user_id: str; plan_id: str; plan_lineage_id: str; revision_number: int
  step_order: int; step_type: str; payload: Dict[str, Any]; status: str = "proposed" ...

@dataclass(frozen=True)
class RecordStateDependencyRequest:  # ← TS SpecialistMutation kind="RecordStateDependency"
  actor: str; user_id: str; plan_step_id: str; target_node_id: str
  target_node_type: str; target_table: str; observed_version: int
  snapshot_value: Dict[str, Any]; depended_property: Optional[str] = None

@dataclass(frozen=True)
class TransferPointsRequest:    # ← TS BalanceTransferInput (replan path)
  actor: str; user_id: str; source_balance_id: str; dest_balance_id: str
  amount_points: int; source_expected_version: int; dest_expected_version: int
  idempotency_key: str; request_hash: str; read_set: tuple[ReadSetEntry, ...] = ()
```

`V31GraphWriteService` methods called: `create_plan`, `create_plan_step`,
`record_state_dependency`, `transfer_points`, `with_occ_retry`,
`claim_replan_job_for_source`, `promote_replan_job_success`, `fail_replan_job`.

- **Transport decision (FROZEN for this milestone):** M3 reaches `V31GraphWriteService` via the **existing argv-in / one-JSON-line-stdout bridge contract** (`bridge-service.ts` style: `execFile(pythonBin, [script, command, ...argv], {maxBuffer:16MB, timeout:30_000, killSignal:"SIGKILL"})`, env allow-listed, **`CLERK_SECRET_KEY` withheld**). Adding an in-process Python/psycopg driver is **out of scope** (none exists in this env). New bridge subcommands (e.g. `orchestrator-create-plan`, `orchestrator-commit-step`, `orchestrator-record-dependency`) are added to `hero_bridge.py` *additively*; the legacy `create-plan`/`balance-transfer` commands stay untouched for `python-legacy`.
- **Validation owner:** **two layers, both authoritative** — M3 validates TS-side (Contract 4) and `V31GraphWriteService` re-validates server-side (`_validate_create_plan`, `_validate_create_plan_step`, `_validate_record_state_dependency`, `_validate_transfer_points`, `validate_read_set`, actor==user checks). The Python layer is the final arbiter and owns OCC.
- **Failure semantics:** Python returns `{ok:false, error:{code,message}}`; M3 maps `code` → `CommitFailure` kind (OCC/version stale → `ConflictError`; idempotency mismatch → `IdempotencyConflict`; validation → `ValidationError`). Bridge timeout/non-zero exit → `CommitFailure("UnexpectedCommitError")`. **No fallback** — failure surfaces as a typed error.
- **Idempotency responsibility:** **the Python `transfer_points()` SQL function owns durable idempotency** (`idempotency_records`, `schema.sql:880`) keyed by `idempotency_key` + `request_hash`. M3 supplies a stable `request_hash` derived from the mutation fingerprint. OCC (`source/dest_expected_version`, `read_set`) is enforced inside the write txn (`pg_advisory_xact_lock`, `schema.sql` `transfer_points()` body). M3 must **not** reimplement enqueue/idempotency in app code.
- **User-scoping:** every request carries `user_id` and `actor`; `_validate_actor_user` enforces `actor == user_id` for specialist writes. The advisory lock is per-user (`_lock_user`). M3 sets both from the commit binding's `userId`.
- **Production implementation:** M3 → new additive `hero_bridge.py` subcommands → `V31GraphWriteService` (LIVE, unchanged) → `psql` CLI → Postgres.
- **Current test double:** `in-memory-commit.ts` short-circuits this seam entirely (writes to in-memory Maps via `InMemoryOrchestratorGraphWrite`); there is **no** Python double — the live path is covered by `tests/` (Python `unittest`) and live-PG integration tests gated by `RUN_LIVE_POSTGRES_TESTS=1`.
- **Likely repository touch areas:** `apps/api/bridge/hero_bridge.py` (NEW additive subcommands), `apps/api/src/agents/commit/python-write-bridge.ts` (NEW — the marshaller M3 calls), `tests/test_orchestrator_bridge_commands.py` (NEW Python `unittest`), live-PG integration test. **`schema/mutations.py` and `schema/schema.sql` are NOT modified** (frozen persistence boundary).

---

### Contract 7 — Persisted Plan → PlanView

After the orchestrator commits, the engine must return the canonical `PlanView`
the Next.js shell consumes. The DB is the source of truth; the view is a thin
projection (thesis claims 11, 12 — one `current` per lineage).

**Decision (ACCEPTED 2026-06-27):** reuse the existing Python `project_plan`
projection for the thesis milestone. The Python **projection function** is
reused — the Python Plan engine (D031 / `hero_bridge.py` plan-generation
commands) is **not** invoked on this path. A TypeScript projection is deferred.

**Exact TS type** (`apps/api/src/plans/types.ts`, FROZEN public contract):

```ts
export interface PlanView {
  planId: string; planLineageId: string; revisionNumber: number;
  status: "generating" | "current" | "stale" | "superseded" | "failed";
  query: string; summary: string | null;
  steps: PlanStepView[];     // {order,type,summary,reasoning,status,dependsOn[],dependencies[]}
  graph: PlanGraphView;      // {nodes[],edges[]} derived from steps
}
export interface BalanceTransferResult {
  planLineageId: string; staledPlanId: string | null; replanJobId: string | null; currentPlan: PlanView;
}
```

**Port interface** (`apps/api/src/orchestrator/contracts.ts`, FROZEN — lives in
the repo so both branches can import it; see file for full JSDoc):

```ts
export interface PlanProjectionPort {
  project(planId: string, userId: string): Promise<PlanView | null>;
}
```

This port lives in the repo's orchestrator contracts file (not in `_bmad-output/`),
so both the `integration` branch and the `production-adapter` branch build against
the same frozen interface without needing external planning docs.

- **Validation owner:** M6 (`OrchestratorPlanService`) calls `PlanProjectionPort.project`
  and **must validate** the returned shape (assert required fields are present, non-null
  `planId`/`planLineageId`/`status`/`steps`) before returning to the HTTP route. A
  malformed projection is a 500-class internal error, not a silent empty plan. The
  partial-unique index (one `current` per `plan_lineage_id`) is enforced by the DB.
- **Failure semantics:** `getPlanById`/`getCurrentPlan` return `PlanView | null` (404
  when null). A bridge timeout, non-zero exit, or shape-validation failure in M6 → 500.
- **Idempotency responsibility:** none — read projection. Refetch after SSE is the
  canonical reconciliation (SSE is observability only, not source of truth).
- **User-scoping:** `project(planId, userId)` filters by `user_id`. A user can never
  read another user's plan. The Python `project_plan` implementation and the new read
  subcommand must both enforce this filter explicitly.
- **Access control:** `PlanProjectionPort` is a dependency of M6 **only**. It is
  absent from `AgentContext` (Contract 3) — specialists have no path to the projection
  function, directly or indirectly.
- **Labeling:** the `hero_bridge.py` read subcommand must be named `read-plan` (or
  `project-plan`) — clearly distinct from the plan-generation commands
  (`create-plan`, `balance-transfer`, etc.). Log lines must identify it as a
  projection-read, not a plan-generation invocation, so G5 (no-fallback verification)
  can confirm the Python Plan engine was never called.
- **Contract-parity test (required):** `apps/api/tests/plans/orchestrator-service.test.ts`
  must include a live-PG test (gated `RUN_LIVE_POSTGRES_TESTS=1`) that runs the demo
  fixture through both `OrchestratorPlanService` and `BridgePlanService` and asserts
  the returned `PlanView` shapes match. This is the automated G1 gate.
- **Production implementation:** M6 holds a `PlanProjectionPort` and calls it after
  `Orchestrator.run()` returns a `PlanResult`. The port adapter marshals to the
  `hero_bridge.py` `read-plan` subcommand (additive, same argv-in/JSON-stdout
  transport as Contract 6). Both engines share this projection path — there is
  intentionally **one** `PlanView` implementation for the milestone.
- **Current test double:** `fixtures/mock-plan.json` (doc-reference shape only);
  `plans/routes.test.ts` exercises the view shape through route tests.
- **Likely repository touch areas:** `apps/api/bridge/hero_bridge.py` (NEW `read-plan`
  additive subcommand, Branch B); `apps/api/src/orchestrator/contracts.ts` (ALREADY
  UPDATED — `PlanProjectionPort` added); `apps/api/src/plans/orchestrator-service.ts`
  (M6 injects `PlanProjectionPort`, Branch A); `apps/api/tests/plans/orchestrator-service.test.ts`
  (parity test, Branch A). `plans/types.ts` is **NOT modified**.

---

## 2. Smallest two-specialist flow (hypothesis-proving)

**Selected pair: `wallet_agent` + `redemption_agent`.** This is the pair PROMPT A
prefers, and **repository evidence makes it the only pair that proves the full
hypothesis** — not merely an acceptable default:

| Evidence | Source | Consequence |
|---|---|---|
| `redemption_agent` is the **sole** owner of `RecordStateDependency` | `agents/ownership.ts` (`redemption_agent: ["CreatePlanStep","RecordStateDependency"]`) | Only redemption can write the `state_dependencies` edge that `transfer_points()` reads to **structurally stale** a plan (claims 8, 9, 10, 11, 12). Drop redemption → no structural-invalidation proof. |
| `wallet_agent` owns `UpdateUserBalance` only | `agents/ownership.ts` (`wallet_agent: ["UpdateUserBalance"]`) | Supplies the **second distinct specialist** (claim 2) and exercises the balance node + OCC version bump. |
| `earning_agent` owns `CreatePlanStep` only | `agents/ownership.ts` | Cannot record a dependency → cannot demonstrate invalidation. Adds a third run without adding thesis coverage → excluded from the flow. |
| Both shapes already proven by doubles | `tests/helpers/fake-agents.ts` (`FakeWalletAgent`, `FakeRedemptionAgent`) | M2 adapters mirror exactly-tested mutation shapes → lowest implementation risk. |

**Decomposition (deterministic, fixed):** for the demo query the `Decomposer`
emits two invocations in order — `wallet_agent` (assess), then `redemption_agent`
(traverse). Sequential, halt-on-failure (`orchestrator.ts`).

This pair exercises **all 14 thesis claims** at minimum cardinality: two distinct
specialists, constrained read-only snapshots, no free-text field, write-only-via-
`commit`, ownership rejection (wallet attempting a plan step → `OwnershipError`;
redemption attempting a balance update → `OwnershipError`), single controlled
write boundary, committed-state dependency, structural invalidation on transfer,
orchestrator replan re-entry, rev1→superseded / rev2→current, and `agent_runs`
observability.

---

## 3. One exact demo fixture (FROZEN)

Grounded entirely in `fixtures/demo-seed.json` (the live seed) — **not** the test
stub's invented numbers. UUIDs abbreviated to their distinctive suffix.

| Field | Value |
|---|---|
| **User / persona** | `…a001` — `clerk_id=clerk_hero_demo`, "Hero Demo User", `isDemoPersona=true` (any sign-in maps here; ADR 0006 identity-only) |
| **Query** | "Book a 3-night Hyatt award stay in Tokyo in October using my points." → goal `specific_redemption`, target Hyatt program `…b002`, target redemption option `…f001` (Hyatt Ginza 3-night, `min_points=45000`) |
| **Initial balances** | Chase UR (`…b001`, balance node `…d001`) = **180,000** (v1); Hyatt (`…b002`, node `…d002`) = **30,000** (v1); United (`…b003`, node `…d003`) = 30,000 (v1) |
| **Expected revision 1** | `status=current`, ≥2 `agent_runs` (`wallet_agent` then `redemption_agent`). Redemption step = `redemption_recommendation`(option `…f001`, source `…b001`) recommending **transfer 15,000 Chase UR → Hyatt** to reach 45,000, then redeem. A `RecordStateDependency` edge ties that step to **Chase UR balance `…d001` @ observed_version 1, snapshot 180,000** (Hyatt is short by 15,000, so the plan depends on the Chase funding source) |
| **Balance transfer** | `DEMO_TRANSFER` (`lib/api/adapters.ts`): source program `…b001` (Chase UR) → dest program `…b002` (Hyatt), **amount 30,000** points. Result: Chase UR 180,000 → **150,000** (version bumps); Hyatt 30,000 → **60,000** |
| **Expected revision 2 difference** | The transfer **structurally stales** rev 1 (Chase UR `…d001` version no longer matches the recorded dependency → exactly the dependent step + plan go `stale` in the `transfer_points()` txn; `replan_jobs` row enqueued). Orchestrator re-enters on the changed snapshot. **Rev 2 = no transfer/top-up step** — Hyatt now holds 60,000 ≥ 45,000, so redemption is recommended **directly from Hyatt**. Rev 1 → `superseded`, rev 2 → `current` (one current per lineage). The observable diff: the Chase→Hyatt transfer recommendation present in rev 1 is **absent** in rev 2 |

> Verification surface: `agent_runs` (≥2 distinct `agent_type`), `graph_mutations`
> (balance change + stale flips, streamed via SSE), `GET /plans/current` returns
> rev 2, `GET /health` reports `orchestrator`, logs show the bridge plan/replan
> commands were never invoked (only the additive orchestrator/commit subcommands).

---

## 4. File-ownership map — two parallel branches

Goal: two branches develop concurrently with **near-zero overlapping files**. The
only shared edit point is `server.ts` (the M5 factory seam), sequenced last.

### Branch A — `integration` (mount + select; keystone)

Owns the engine seam and the service that drives the existing `Orchestrator`.

| File | Action | Contract |
|---|---|---|
| `apps/api/src/plans/orchestrator-service.ts` | NEW (M6 — injects `PlanProjectionPort`) | 1, 7 |
| `apps/api/tests/plans/orchestrator-service.test.ts` | NEW (includes live-PG parity test for G1) | 1, 7 |
| `apps/api/src/server.ts` | EDIT — M5 `PLAN_ENGINE` factory (replace hardcoded `new BridgePlanService()`); add engine to `/health` | 1 |
| `apps/api/src/plans/engine-selector.ts` | NEW (M5 factory, fail-fast) | 1 |
| `apps/api/tests/plans/engine-selector.test.ts` | NEW | 1 |
| `apps/api/src/agents/registry.ts` | NEW — assembles `AgentRegistry` from M2 adapters (consumes prod-adapter exports) | 3 |

### Branch B — `production-adapter` (the real adapters; no `server.ts` edit)

Owns every M1–M4/M7–M9 adapter and the additive Python bridge subcommands.

| File | Action | Contract |
|---|---|---|
| `apps/api/src/agents/snapshot/pg-snapshot-builder.ts` (+ test) | NEW (M1) | 2 |
| `apps/api/src/agents/wallet/wallet-agent.ts` (+ test) | NEW (M2; extends RCG-16) | 3 |
| `apps/api/src/agents/redemption/redemption-agent.ts` (+ test) | NEW (M2) | 3 |
| `apps/api/src/agents/earning/earning-agent.ts` | NEW (M2; minimal conformant, not in flow) | 3 |
| `apps/api/src/agents/commit/validation.ts` | NEW — shared validation+ownership (extracted from `in-memory-commit.ts`; M7) | 4 |
| `apps/api/src/agents/commit/controlled-commit.ts` (+ test) | NEW (M3, M8) | 4 |
| `apps/api/src/agents/commit/python-write-bridge.ts` (+ test) | NEW — TS marshaller to bridge | 6 |
| `apps/api/src/orchestrator/graph-write/agent-run-repository.ts` (+ test) | NEW (M4) | 5 |
| `apps/api/src/orchestrator/graph-write/orchestrator-graph-write.ts` (+ test) | NEW — assembles `OrchestratorGraphWrite` (M3+M4) | 5, 6 |
| `apps/api/bridge/hero_bridge.py` | EDIT — additive `orchestrator-*` subcommands (legacy commands untouched) | 6, 7 |
| `tests/test_orchestrator_bridge_commands.py` | NEW (Python `unittest`) | 6 |

### Overlap & sequencing (minimized)

- **Only shared file:** `apps/api/src/server.ts` — edited **only** by branch A.
  Branch B touches no integration file.
- **`agents/registry.ts` boundary:** branch A imports the M2 adapter classes that
  branch B exports — coordinate the export surface (interface in `agents/contracts.ts`,
  FROZEN) up front so the import compiles without a merge edit.
- **`hero_bridge.py`:** edited **only** by branch B, additively; no overlap with
  branch A. (Watch only against PR #50, which also edits backend deploy files — see §6.)
- **FROZEN (neither branch edits):** `agents/contracts.ts`,
  `orchestrator/contracts.ts` (already updated: `PlanProjectionPort` added — do not
  edit further), `orchestrator/orchestrator.ts`, `orchestrator/decomposition.ts`,
  `agents/ownership.ts`, `plans/service.ts`, `plans/types.ts`,
  `schema/mutations.py`, `schema/schema.sql`.
- **Merge order:** branch B merges first (adapters exist) → branch A merges second
  (mounts them via the factory + registry). This keeps the `server.ts` edit last and
  conflict-free.

---

## 5. Cutover checklist

Pre-flight, in order. Each maps to an ADR 0010 gate (G1–G7).

- [ ] **PR #50 merged to `main`** (schema/seed bootstrap + doc reconciliation); `tests/test_runtime_architecture_docs.py` green. *(prerequisite; ADR 0010 §10)*
- [ ] `agent_runs` confirmed present after bootstrap (DDL-only today; no migration). `token_count` left `NULL`.
- [ ] Branch B merged: M1–M4, M7, M8, M9 adapters + additive bridge subcommands; all three test stacks green with ≥90% diff coverage (web Vitest / api Vitest / Python `unittest`); live-PG tests run with `RUN_LIVE_POSTGRES_TESTS=1`.
- [ ] Shared validation/ownership extracted to one module; in-memory double re-points to it (no logic drift between double and prod).
- [ ] Branch A merged: M5 factory + M6 `OrchestratorPlanService` + registry; `server.ts` selects engine once at boot; `/health` reports engine.
- [ ] **G1 plan parity:** demo fixture → equivalent `PlanView` under `orchestrator` and `python-legacy` (golden compare).
- [ ] **G2:** `agent_runs` shows ≥2 distinct `agent_type` for one orchestrator plan.
- [ ] **G3 boundary integrity:** grep proves only M3 calls the write seam from TS; unowned/invalid mutation → typed `CommitFailure` with **zero** DB rows.
- [ ] **G4 invalidation + replan:** `DEMO_TRANSFER` stales exactly the dependent step+plan in one txn; orchestrator re-enters; rev1→`superseded`, rev2→`current`.
- [ ] **G5 no fallback:** `PLAN_ENGINE=orchestrator` run logs show bridge plan/replan commands never invoked; orchestrator failure → typed error, not a bridge retry.
- [ ] **G6 real-JWT browser run:** thesis DoD (architecture-option-b §13) passes with a real Clerk token, no fixtures, no fallback.
- [ ] `/security-review` + `/simplify` on the branch diffs; Clerk secret never crosses the bridge allow-list; no `.env*` committed.
- [ ] **G7:** two consecutive green orchestrator runs recorded before any legacy-removal discussion.

## No-go conditions (any one blocks cutover; revert to `python-legacy`)

- **PR #50 not merged** and a deployed/hosted run is attempted (DB not provisioned at boot).
- **Any silent fallback** observed — orchestrator failure transparently served by the bridge, or `PLAN_ENGINE` unset not failing fast at boot. *(Thesis-invalidating.)*
- **A second TS write seam** exists — any TS file other than M3 reaching the write boundary, or any `INSERT/UPDATE/DELETE` in `.ts`. *(Invariant 2.)*
- **Free-text inter-agent channel** introduced — any `message`/`prompt`/`queryText`/`otherAgents` field reaching an agent. *(Thesis claim 4.)*
- **`schema/mutations.py` or `schema/schema.sql` modified** to make a write fit (persistence boundary must stay frozen; schema is locked/additive-only — ADR 0001).
- **Ownership or validation weakened** to pass a test (e.g., editing `agents/ownership.ts` so a specialist can write outside its set).
- **Coverage gate gamed** — any threshold lowered, `omit`/`exclude` widened, or `expect(sql).toContain(...)` style assertion added. *(project-context Testing invariants.)*
- **`agent_runs` shows <2 distinct specialists**, or rev2 does not become the single `current` for the lineage (structural-invalidation proof failed).
- **Token-count work blocks the run** — if RCG-53 is treated as a gate rather than additive. *(ADR 0010 §7: token fields are non-blocking.)*

---

## 6. Residual watch-items (not blockers)

- **PR #47 rebase drift** (`val/graph-fe`, branched pre-#48) touches proxy routes +
  `hero_bridge.py`; rebase onto `main`, resolve backend in `main`'s favor before it
  collides with branch B's additive bridge edits.
- **`request_hash` derivation** for Contract 6 idempotency must be stable across
  retries — pin the fingerprint algorithm in M3 (mirror `stableFingerprint` from the
  in-memory double) so TS and the SQL `idempotency_records` agree.

---

## Conclusion

**CONTRACTS READY**

All seven seams are frozen against live code with exact types; the two-specialist
flow is selected with binding repository evidence (Wallet + Redemption — redemption
is the sole `RecordStateDependency` owner); one demo fixture is pinned to the real
seed; the two branches partition with a single, last-sequenced shared edit
(`server.ts`); and the cutover checklist + no-go conditions are explicit. The four
open decisions from `architecture-option-b.md §19` are resolved by ADR 0010
(opt-in milestone with D031 default; deterministic specialists; `token_count`
nullable so no schema change; PR #50 before context-doc edits).

**No contract-level blockers.** The remaining items are *sequencing prerequisites
and watch-items*, not blockers:

- PR #50 must merge before context-doc edits / any deployed run (cutover gate, not a contract gap).
- PR #47 rebase hygiene before branch B's `hero_bridge.py` edits land (watch-item).
- Contract 7 is **CLOSED** (2026-06-27): Python `project_plan` reuse accepted;
  `PlanProjectionPort` interface committed to `apps/api/src/orchestrator/contracts.ts`;
  five requirements locked (user scoping, runtime validation, parity test, no specialist
  access, clear labeling). Both branch lanes build against the in-repo interface.
