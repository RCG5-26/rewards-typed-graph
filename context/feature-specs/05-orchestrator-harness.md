# 05 — Orchestrator + agent harness

- **Status:** Done
- **Owner:** Raq · **Lane:** Orchestrator/Agents
- **Linear:** RCG-15
- **Depends on:**
  - schema-final v3.1 (`docs/architecture/schema-final.md`) — locked (ADR 0001).
  - **Non-blocking deferred dependency:** the canonical generated TypeScript mutation contract (Phase A3 codegen, ADR 0007) and the real graph-write service (spec 02). Spec 05 ships a **temporary** typed mutation union and in-memory adapters; the exact replacement seam is the `AgentCommitFactory` / `OrchestratorGraphWrite` interfaces (§9, §10) — see §20.
- **Related flows:** [Flow 1: Create a rewards plan](../project-overview.md), [Flow 2: Update state and automatically re-plan](../project-overview.md)

---

## 1. Definition of Ready

- [x] Goal and out-of-scope unambiguous
- [x] Acceptance criteria testable
- [x] Contracts linked (§4)
- [x] Touch list filled with exact, repository-correct paths (§14)
- [x] Dependencies + Linear ids recorded
- [x] Typed mutation contract resolved: **closed** temporary discriminated union with **no generic payload field**, derived from the canonical sources (`schema/mutations.py`, `schema/generated/types.ts`, schema-final §4.3–4.4), with an exact replacement seam (§10)
- [x] Typed agent-operation contract resolved, coupled to agent type at compile time (`Agent<K>` / `AgentContext<K>`, §6.2–6.3)
- [x] Mutation ownership enforcement resolved; orchestrator commands modeled as a typed method port, not as mutations (§6.4, §9)
- [x] Decomposer output treated as an untrusted boundary with exact runtime validation (§6.5)
- [x] Commit-failure lifecycle resolved, including **atomic** mutation+checkpoint semantics (§10.3, §10.6)
- [x] Persistence/write-boundary model reconciled with the graph-write invariant (§9)
- [x] Exact `AgentCommitFactory`, `AgentRegistry`, `GraphSnapshotBuilder`, and `Orchestrator` constructor interfaces defined (§8, §10.2)

**Readiness rationale.** Every implementation-critical contract is fixed and exhaustively typed. The only deferred items — the *generated* TS mutation types (Phase A3) and spec 02's real write path — are reached **only** through the `AgentCommitFactory` / `OrchestratorGraphWrite` interfaces and a single temporary union file. No test or public behavior in this unit depends on their final form; when they land, the temporary union (§10.1) is replaced by a generated import and the in-memory adapters by the real ones, with no change to the orchestrator, the agent contract, or the named tests.

---

## 2. Goal

Implement the TypeScript orchestrator loop and agent harness — the scaffold that makes **"agent coordination occurs through typed graph state and typed mutations only; no free-text inter-agent messaging"** true in code.

The orchestrator receives a natural-language planning query, decomposes it (via an injected `Decomposer`) into an **ordered sequence of typed agent invocations**, **validates** that sequence at the trust boundary, and runs specialist agents in order. Each agent receives a **typed operation narrowed to its own agent type** plus a read-only `GraphSnapshot` and exactly one write capability (`commit`) inside a typed `AgentContext<K>`.

This unit builds and tests end-to-end against in-memory doubles. No live database, no completed spec 02, and no live LLM are required.

### 2.1 Scope and non-goals

**In scope:** orchestrator loop; typed decomposition contract + runtime validation; per-agent-type typed operations; agent harness capability boundary; closed specialist mutation contract; mutation-ownership enforcement; commit-failure + atomic-checkpoint semantics; Plan/AgentRun lifecycle; in-memory doubles; named tests.

**Out of scope (non-goals):** the real graph-write service and OCC/advisory-lock/audit/staleness machinery (spec 02); Phase A3 codegen of canonical mutation types (ADR 0007); the LLM-backed `Decomposer` implementation; the Python subprocess protocol and credential isolation (specs 04/06, ADR 0007); the re-plan worker, lineage revisioning, and `stale`/`superseded` transitions (ADR 0005, RCG-57); world-graph snapshot fields (transfer routes, earn edges); parallel orchestration; richer domain payload fields on plan steps (specs 04/06); a monorepo workspace root (later infra).

**What this unit does and does not enforce (accurate scope of TypeScript guarantees) — see §5.**

---

## 3. User and system behavior

### Flow 1 — Create a rewards plan (spec 05 scope)

1. Orchestrator receives `PlanRequest { userId, queryText }`. **New plans only** — no existing lineage is accepted in this unit (§7).
2. Orchestrator submits a `createPlan` graph-write command: new `plan_lineage_id` (`crypto.randomUUID()`), `revision_number = 1`, `status = 'generating'`, `plan_type = 'agent_generated'`, `query_text = queryText`.
3. `Decomposer.decompose(queryText)` returns raw `unknown` output. The orchestrator immediately passes it to `validateDecomposedQuery` (step 4) before treating it as a `DecomposedQuery`. **`queryText` is interpreted only by the `Decomposer` and is never passed to a specialist agent.** (It is also stored verbatim in the `createPlan` command for audit, but never propagated to invocations or operations.)
4. **Decomposition validation (trust boundary, §6.5).** The orchestrator runs `validateDecomposedQuery(raw)` **before creating any `AgentRun`**. On failure it submits `transitionPlanStatus(planId, 'failed')`, creates **no** `AgentRun`, invokes **no** agent, and **throws** a single typed `OrchestrationError { kind: 'DecompositionInvalid' }`. On success it holds a validated `DecomposedQuery`.
5. For each validated `AgentInvocation` in array order (sequential), dispatched through a type-correlated switch on `agentType` (§6.3):
   - a. Orchestrator submits `createAgentRun`: `status = 'running'`, `agent_type` from the invocation, `plan_id`, `user_id`, `started_at = now()`, `state = null`.
   - b. Orchestrator calls `GraphSnapshotBuilder.build({ userId, planId })` to produce a typed read-only `GraphSnapshot`.
   - c. Orchestrator builds the agent-scoped `commit` via `AgentCommitFactory.create({ userId, planId, agentRunId, agentType })` (§10.2). The factory owns the read-checkpoint merge using the bound `agentRunId`; the orchestrator passes no callback.
   - d. Agent's `run(ctx)` is called with `AgentContext<K> { planId, userId, agentRunId, operation, snapshot, commit }` — no other fields. `operation` is narrowed to `OperationByAgent[K]`.
   - e. Each successful `commit(input)` applies the specialist mutation **and** the read-checkpoint merge **atomically** (§10.6): the factory writes `agent_runs.state.last_read_versions` (using the bound `agentRunId`) inside the same all-or-nothing block as the mutation, before `commit` resolves.
   - f. If `commit(input)` fails for any reason (validation, ownership, idempotency conflict, atomic-write failure, unexpected error), it **rejects** with a typed `CommitFailure` (§10.3). Neither the mutation nor the checkpoint is applied for that call.
   - g. On `run()` resolving: orchestrator submits `finalizeAgentRun → status = 'completed'`, `completed_at = now()`. Proceed to the next invocation.
   - h. On `run()` rejecting/throwing (including a rejected `commit`): orchestrator submits `finalizeAgentRun → status = 'failed'`, `error = err.message`, `completed_at = now()`. **Halt. Do not invoke remaining agents.**
6. All agents completed: orchestrator submits `transitionPlanStatus(planId, 'current')`.
7. Any agent failed: orchestrator submits `transitionPlanStatus(planId, 'failed')`.
8. Return `PlanResult { planId, planLineageId, status: 'current' | 'failed', agentRunIds }`. (A decomposition-validation failure in step 4 throws `OrchestrationError` instead of returning — the Plan row is left `failed` for audit.)

**Behavior invariant:** `queryText` is interpreted only by the `Decomposer` and is never passed to a specialist agent. Agents receive the typed `operation`, `GraphSnapshot`, and `commit` only — never `queryText`, conversation history, or any other agent's output.

---

## 4. Contracts consumed and produced

**Consumed** (link only — do not restate the schema):
- `docs/architecture/schema-final.md §4.6` — `agent_runs`: field names, `status` CHECK (`running`,`completed`,`failed`,`timed_out`), `state` jsonb with `last_read_versions`, `agent_type` CHECK (`orchestrator`,`wallet_agent`,`earning_agent`,`redemption_agent`).
- `docs/architecture/schema-final.md §4.1–4.2` — `plans`: `status` (`generating`,`current`,`stale`,`failed`,`superseded`), `revision_number`, `plan_lineage_id`, partial unique index `plans_one_current_revision`, `plan_type`.
- `docs/architecture/schema-final.md §4.3` — `plan_steps`: `step_type` CHECK (`card_assignment`,`redemption_recommendation`,`spend_analysis`,`transfer_recommendation`), `payload` jsonb (basis for the typed per-step payloads in §10.1).
- `docs/architecture/schema-final.md §4.4` — `state_dependencies`: `target_node_id`, `target_node_type`, `target_table`, `depended_property`, `observed_version`, `snapshot_value`; **MVP staleness scope B2 = personal-tier only (`user_balances`, `user_program_statuses`)** — the basis for the closed `targetTable` union (§10.1).
- `docs/architecture/schema-final.md §5.3` — `idempotency_records`: same key + same `request_hash` → replay; same key + different hash → 409 (§10.5).
- `docs/architecture/schema-final.md §6.2` — **mutation ownership** table (basis for §6.4).
- `schema/generated/types.ts` — generated literal unions `NodeType`, `EdgeType`, `MutationAction` (the canonical literal vocabulary the temporary union mirrors).
- `schema/mutations.py` — the canonical request shapes (`CreatePlanRequest`, `CreatePlanStepRequest`, `RecordStateDependencyRequest`, `TransferPointsRequest`) the temporary union mirrors.
- `context/feature-specs/02-graph-write-path.md` — `commitMutation(userId, mutation, readSet, idempotencyKey)` applies mutation + audit + staleness **in a single transaction** (basis for atomic checkpoint, §10.6).
- `context/architecture-context.md §Invariants` — invariants 1, 2, 3, 6, 7, 11, 13.

**Produced** by spec 05 (all as **orchestrator-owned typed graph-write commands** — §9):
- `Plan` rows (`createPlan` + `transitionPlanStatus`). Orchestrator is the sole Plan writer.
- `AgentRun` rows (`createAgentRun` + `finalizeAgentRun`, one per invocation, with `state.last_read_versions` merged atomically by the commit path).

**NOT produced in spec 05** (deferred):
- `plan_steps`, `state_dependencies` durable rows — owned by specs 04 and 06; agents submit these mutations through the same seam in later specs.
- `targets` (Plan → UserGoal) — deferred.
- `graph_mutations`, `idempotency_records`, `replan_jobs` audit/queue rows — written by spec 02's real path. The in-memory doubles model **call-level** semantics only (§10.5–§10.6).

---

## 5. What TypeScript does and does not guarantee (accurate scope)

The hard constraint is enforced by a combination of **type-level** and **runtime** controls. This unit does **not** provide process-level isolation.

| Control | Mechanism | Strength |
|---|---|---|
| No free-text field on the public invocation contract | `AgentInvocation` is a discriminated union with exactly `agentType` + a typed `operation`; no prose field exists. A stray `prompt`/`message` triggers an excess-property error (`@ts-expect-error` test T29). | Compile-time, through the declared interface |
| Operation is bound to the agent type | `AgentContext<K>.operation` is `OperationByAgent[K]`; an agent of type `K` cannot receive another agent's operation (`@ts-expect-error` test T31). | Compile-time |
| No injected coordination capability | `AgentContext<K>` exposes exactly `planId, userId, agentRunId, operation, snapshot, commit`. The harness injects **no** database client, HTTP client, message bus, peer agent, event emitter, or generic callback (`@ts-expect-error` test T30). | Compile-time, through the declared interface |
| `GraphSnapshot` is read-only | `Readonly<…>` with `ReadonlyArray` rows — no write capability inside the snapshot. | Compile-time |
| Specialist cannot name an orchestrator command | Orchestrator writes are **typed methods** on `OrchestratorGraphWrite`, not mutations; there is no orchestrator mutation type for a specialist to construct. The agent-facing `commit` accepts only `SpecialistMutation` (test T32). | Compile-time |
| No generic mutation payload | Every `SpecialistMutation` variant is closed and exhaustively typed (no `payload: Record<string, unknown>`, no `targetTable: string`); the in-memory adapter validates every variant exhaustively (§12). | Compile-time + runtime |
| Mutation ownership | The commit adapter receives the calling `agentType` and **rejects at runtime** any mutation `kind` the agent does not own, before any state change (§6.4, §10.3). | Runtime, at the commit trust boundary |
| Untrusted decomposer output | `validateDecomposedQuery` rejects unknown/mismatched/malformed invocations and unexpected keys at the orchestrator trust boundary (§6.5). | Runtime, at the decomposition trust boundary |

**Explicitly NOT provided by this unit:**
- Absolute process-level isolation. A determined caller using `as any` casts can fabricate objects at runtime; that is why ownership, mutation structure, and decomposer output are **also** validated at runtime, not asserted purely by type.
- Import-level or credential isolation for Python specialist agents. That is enforced at the **subprocess boundary** (`launcher.ts`, environment allowlist, no `DATABASE_URL`) defined in ADR 0007 and implemented in specs 04/06 — out of scope here (invariant 11).
- `@ts-expect-error` tests prove a construct is **rejected through the declared interface at compile time**. They are not evidence that an arbitrary extra property can never exist on a runtime object reached via casts — which is exactly why runtime validation backstops them.

---

## 6. Detailed boundaries

### 6.1 Orchestrator boundary

| Dimension | Specification |
|---|---|
| **Input** | `PlanRequest { userId: string; queryText: string }` — new plans only (§7) |
| **Output** | `PlanResult { planId: string; planLineageId: string; status: 'current' \| 'failed'; agentRunIds: string[] }` — or **throws** `OrchestrationError` on decomposition-validation failure (§6.5) |
| **Creates / transitions Plan** | Orchestrator only, via the `OrchestratorGraphWrite` typed command port (§9) |
| **Creates / finalizes AgentRun** | Orchestrator only (Python agents have no DB credentials — invariant 11) |
| **Validates decomposer output** | Orchestrator only, before any `AgentRun` is created (§6.5) |
| **Invokes agents** | Orchestrator only, in `DecomposedQuery.invocations` array order; implementer cannot reorder |
| **On agent success** | `finalizeAgentRun(completed)`; continue with next invocation |
| **On agent failure** | `finalizeAgentRun(failed)`; halt immediately; remaining agents NOT invoked; `transitionPlanStatus(failed)` |
| **Orchestration mode** | Sequential. Parallel orchestration is out of scope. |

### 6.2 Natural-language decomposition and the typed operation

The `Decomposer` is the **only** component that reads `queryText`. It is injected at construction.

```typescript
// apps/api/src/orchestrator/contracts.ts  (production interface — exact)

import type { UserGoalType } from "../agents/contracts";

// Returns raw unknown output — the caller MUST validate via validateDecomposedQuery
// (§6.5) before treating the result as a DecomposedQuery. The LLM-backed
// implementation is untrusted; typing it as unknown makes the trust boundary explicit.
export interface Decomposer {
  decompose(queryText: string): Promise<unknown>;
}

export interface DecomposedQuery {
  readonly invocations: readonly AgentInvocation[];
}

// An invocation routes to an agent AND carries that agent's typed task.
// The union ties each agentType to exactly its own operation variant, so an
// agent can only ever receive the operation shaped for it. No free-text field.
export type AgentInvocation =
  | { readonly agentType: "wallet_agent"; readonly operation: WalletAssessmentOperation }
  | { readonly agentType: "earning_agent"; readonly operation: EarningRecommendationOperation }
  | { readonly agentType: "redemption_agent"; readonly operation: RedemptionTraversalOperation };

// Typed decomposed intent. Identifiers + typed constraints only — never prose,
// prompts, instructions, conversation history, or the raw queryText.
export type AgentOperation =
  | WalletAssessmentOperation
  | EarningRecommendationOperation
  | RedemptionTraversalOperation;

// Exact agent-type → operation mapping (used by AgentContext<K>, §6.3).
export interface OperationByAgent {
  readonly wallet_agent: WalletAssessmentOperation;
  readonly earning_agent: EarningRecommendationOperation;
  readonly redemption_agent: RedemptionTraversalOperation;
}

export interface WalletAssessmentOperation {
  readonly kind: "assess_wallet";
  readonly agentType: "wallet_agent";
  readonly programIds: readonly string[];        // reward_programs to assess balances/status for
}

export interface EarningRecommendationOperation {
  readonly kind: "recommend_earning";
  readonly agentType: "earning_agent";
  readonly spendCategoryIds: readonly string[];  // spend_categories to optimize earn for
}

export interface RedemptionTraversalOperation {
  readonly kind: "traverse_redemption";
  readonly agentType: "redemption_agent";
  readonly goalType: UserGoalType;                       // schema enum (user_goals.goal_type)
  readonly targetRedemptionOptionId: string | null;      // redemption_options.id, when specific
  readonly sourceProgramIds: readonly string[];          // candidate source reward_programs
}
```

**Three distinct layers (do not conflate):**

1. **User-authored natural-language input** — `PlanRequest.queryText`. Read **only** by the `Decomposer`.
2. **Typed decomposed intent** — `AgentOperation` / `AgentInvocation`. What agents receive. Typed identifiers and enum constraints only.
3. **Prohibited free-text inter-agent coordination** — no field anywhere on `AgentInvocation`, `AgentOperation`, `AgentContext`, or any mutation carries prose passed between agents. The decomposition validator (§6.5) rejects unexpected keys at runtime.

**Production LLM decomposer:** out of scope. The `Decomposer` interface is the seam; a real LLM-backed implementation is a future spec. Because that implementation is untrusted, its output is validated at the boundary (§6.5).

**Test replacement:** `FakeDecomposer` implements `Decomposer` and returns a pre-built valid object (typed as `Promise<unknown>`) regardless of `queryText` — `validateDecomposedQuery` accepts it because the shape is structurally correct. A `RawDecomposer` returns deliberately malformed `unknown` values for the validation tests (T22–T28). Both live under tests (§11, §14).

### 6.3 Agent harness capability boundary (operation coupled to agent type)

```typescript
// apps/api/src/agents/contracts.ts  (production interfaces — exact)

import type { AgentOperation, OperationByAgent } from "../orchestrator/contracts";

export type SpecialistAgentType = "wallet_agent" | "earning_agent" | "redemption_agent";
export type AgentType = "orchestrator" | SpecialistAgentType;   // mirrors agent_runs.agent_type CHECK

// schema-final §3.4 user_goals.goal_type CHECK
export type UserGoalType =
  | "maximize_points" | "maximize_cashback" | "specific_redemption" | "minimize_fees";

// AgentContext is parameterized by the agent type so operation is narrowed.
export interface AgentContext<K extends SpecialistAgentType> {
  readonly planId: string;
  readonly userId: string;
  readonly agentRunId: string;
  readonly operation: OperationByAgent[K];   // typed decomposed task narrowed to K — NOT queryText
  readonly snapshot: GraphSnapshot;
  readonly commit: AgentCommit;
  // No: db, http, bus, otherAgents, callback, emit, message, prompt, queryText, planRepository, graphWrite
}

export interface Agent<K extends SpecialistAgentType> {
  readonly agentType: K;
  run(context: AgentContext<K>): Promise<void>;
}

// Exhaustive registry: exactly one agent per specialist type, each correctly typed.
export type AgentRegistry = {
  readonly [K in SpecialistAgentType]: Agent<K>;
};

// Read-only personal-tier snapshot for spec 05. Specs 04/06 extend with
// world-graph fields (transfer routes, earn edges) without breaking changes.
export type GraphSnapshot = Readonly<{
  userBalances: ReadonlyArray<UserBalanceRow>;
  userGoals: ReadonlyArray<UserGoalRow>;
  userProgramStatuses: ReadonlyArray<UserProgramStatusRow>;
}>;

export interface UserBalanceRow {
  readonly id: string;
  readonly programId: string;
  readonly balancePoints: number;
  readonly version: number;
}
export interface UserGoalRow {
  readonly id: string;
  readonly goalType: UserGoalType;
  readonly targetRedemptionOptionId: string | null;
}
export interface UserProgramStatusRow {
  readonly id: string;
  readonly programId: string;
  readonly statusTier: string;
  readonly version: number;
}

export interface GraphSnapshotBuilder {
  build(input: { userId: string; planId: string }): Promise<GraphSnapshot>;
}
```

**Type-correlated dispatch.** TypeScript cannot correlate two independent indexed accesses (`registry[invocation.agentType]` and `invocation.operation`) on its own, so the orchestrator dispatches through an exhaustive `switch` on `invocation.agentType`. Inside each case both the agent and the operation are narrowed to the same `K`, preserving `Agent<K>` ↔ `AgentContext<K>` at compile time:

```typescript
// apps/api/src/orchestrator/orchestrator.ts  (dispatch sketch — exact pattern)
switch (invocation.agentType) {
  case "wallet_agent":
    return this.registry.wallet_agent.run(this.context("wallet_agent", invocation.operation, …));
  case "earning_agent":
    return this.registry.earning_agent.run(this.context("earning_agent", invocation.operation, …));
  case "redemption_agent":
    return this.registry.redemption_agent.run(this.context("redemption_agent", invocation.operation, …));
}
```

Because `AgentRegistry` is an exhaustive `Record` over `SpecialistAgentType` and a valid `agentType` is guaranteed by §6.5 validation before dispatch, **a registered agent always exists** — there is no "missing agent" runtime branch. An *invalid* `agentType` never reaches dispatch; it is rejected at decomposition validation.

**How graph reads are supplied:** the orchestrator calls `GraphSnapshotBuilder.build({ userId, planId })` before invoking each agent. In spec 05 the only implementation is a test stub returning fixture data (`StubGraphSnapshotBuilder`, under tests). The DB-backed implementation is deferred (graph-query, spec 02 lane).

### 6.4 Mutation ownership (enforceable boundary)

Ownership follows `schema-final.md §6.2`, narrowed to what this unit exercises. **Specialist mutations** and **orchestrator commands** are modeled separately (§9):

- **Specialist mutations** are members of `SpecialistMutation` (§10.1), owned per agent type and submitted through `commit`.
- **Orchestrator commands** are the **typed methods** on `OrchestratorGraphWrite` (§9). They are *not* mutation variants and carry no `kind`; the method signatures themselves are the closed orchestrator command contract. The orchestrator additionally owns the `AgentRun` lifecycle because Python specialist agents have no DB credentials (invariant 11).

| Writer | Owned specialist mutation `kind`s (spec 05) | Schema basis |
|---|---|---|
| `wallet_agent` | `UpdateUserBalance` | §6.2 (personal-tier; wallet is sole writer of `user_balances`) |
| `earning_agent` | `CreatePlanStep` | §6.2 (own plan-step contributions) |
| `redemption_agent` | `CreatePlanStep`, `RecordStateDependency` | §6.2 (`plan_steps`, `state_dependencies`) |
| `orchestrator` | *(no specialist mutations)* — owns the `OrchestratorGraphWrite` command methods only | §6.2 (`plans`); §4.6 (`agent_runs`) |

```typescript
// apps/api/src/agents/ownership.ts  (production — exact)
import type { SpecialistAgentType } from "./contracts";
import type { SpecialistMutationKind } from "./contracts";

export const MUTATION_OWNERSHIP:
  Readonly<Record<SpecialistAgentType, ReadonlyArray<SpecialistMutationKind>>> = {
  wallet_agent:     ["UpdateUserBalance"],
  earning_agent:    ["CreatePlanStep"],
  redemption_agent: ["CreatePlanStep", "RecordStateDependency"],
} as const;

export function isOwnedBy(agentType: SpecialistAgentType, kind: SpecialistMutationKind): boolean {
  return MUTATION_OWNERSHIP[agentType].includes(kind);
}
```

**Where ownership is checked:**
- **Type level (compile time):** the agent-facing `AgentCommit` accepts only `SpecialistMutation` (§10.1). There is **no orchestrator mutation type**, so a specialist literally cannot name a `createPlan`/`transitionPlanStatus` command — those exist only as methods on a port absent from `AgentContext`. This makes tests T31–T32 compile-time guarantees.
- **Runtime (at the commit trust boundary):** the adapter is bound to `agentType` and calls `isOwnedBy(agentType, mutation.kind)`. A mutation the agent does not own — or an unknown `kind` smuggled in via an `as any` cast — is rejected (`OwnershipError` for a known-but-unowned kind, `ValidationError` for an unknown kind) **before** the mutation is recorded. No state change occurs.

**Result:** specialist agents cannot create or transition `Plan` rows (no command is reachable from `AgentContext`), and one specialist cannot submit another specialist's mutation. The orchestrator remains the sole `Plan` writer because the `OrchestratorGraphWrite` port is injected into the `Orchestrator` constructor only.

### 6.5 Decomposition validation (untrusted-boundary contract)

The future LLM-backed `Decomposer` is untrusted. `validateDecomposedQuery` runs at the orchestrator boundary (§3 step 4), **before any `AgentRun` is created**, using a narrow manual type guard (no runtime-schema dependency is added).

```typescript
// apps/api/src/orchestrator/decomposition.ts  (production — exact)
import type { DecomposedQuery } from "./contracts";

// Returns the validated query (same shape, now trusted) or throws OrchestrationError.
export function validateDecomposedQuery(raw: unknown): DecomposedQuery;

// apps/api/src/orchestrator/contracts.ts  (production — exact)
export type OrchestrationErrorKind = "DecompositionInvalid";

export class OrchestrationError extends Error {
  constructor(
    readonly kind: OrchestrationErrorKind,
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "OrchestrationError";
  }
}
```

**Rejection conditions** (each → `OrchestrationError { kind: 'DecompositionInvalid' }`):

| Condition | Notes |
|---|---|
| `invocations` is missing, not an array, or **empty** | An empty plan has no work; treated as invalid. |
| `invocation.agentType` is not a `SpecialistAgentType` | Unknown agent. |
| `operation.kind` is not a known operation kind | Unknown operation. |
| `invocation.agentType !== operation.agentType` | Mismatched routing. |
| `operation.kind` is not the kind valid for that `agentType` | e.g. `wallet_agent` with `traverse_redemption`. |
| A required identifier is missing/empty (e.g. empty `programIds`, empty `sourceProgramIds`, empty `goalType`) | Per operation type. |
| An enum value is invalid (e.g. `goalType` not in `UserGoalType`) | Closed-set check. |
| Any **unexpected key** appears on an invocation or operation | Backstops the "no free-text coordination field" invariant at runtime. |

**On failure (§3 step 4):** the already-created `generating` Plan is transitioned to `failed`; **no** `AgentRun` is created; **no** agent is invoked; **no** specialist commit occurs; the orchestrator **throws** the single typed `OrchestrationError`. Distinguishing this from an agent-run failure: a malformed planning request surfaces as a thrown `OrchestrationError`; an agent failing mid-run surfaces as `PlanResult.status === 'failed'`. In both cases the Plan row ends `failed` for audit.

---

## 7. Plan lifecycle (spec 05 scope)

Using exact status values from `schema-final.md §4.1`.

| Action | `plans.status` | Command | Who |
|---|---|---|---|
| `createPlan` | `generating` | `OrchestratorGraphWrite.createPlan` | Orchestrator |
| Decomposition invalid (§6.5) | `failed` | `transitionPlanStatus` | Orchestrator |
| All agent runs complete | `current` | `transitionPlanStatus` | Orchestrator |
| Any agent run fails | `failed` | `transitionPlanStatus` | Orchestrator |

**New plans only.** `PlanRequest` accepts no `planLineageId`. The orchestrator generates a fresh `plan_lineage_id` (`crypto.randomUUID()`) and sets `revision_number = 1`. Accepting an existing lineage and computing the next revision belongs to the durable re-plan worker (ADR 0005, RCG-57) and is out of scope.

**`plan_type`:** always `'agent_generated'` in this unit.

**One-current-revision invariant (invariant 6) — enforcement point.** Creating a `generating` plan does **not** by itself violate the invariant. The invariant is enforced **atomically at the transition to `current`**, mirroring the DDL partial unique index:

```sql
CREATE UNIQUE INDEX plans_one_current_revision
  ON plans (plan_lineage_id) WHERE status = 'current';
```

In the in-memory orchestrator graph-write double (§9), `transitionPlanStatus(planId, 'current')` rejects if another revision of the same `plan_lineage_id` is already `current`. Because this unit creates exactly one revision per (new) lineage, the check never trips here, but the double enforces it so the harness faithfully models the locked constraint. In the real system the partial unique index is authoritative.

**`stale`/`superseded`:** not reachable in this unit (no re-plan worker, no invalidation). `plan_steps`, `targets`: not created here.

---

## 8. AgentRun lifecycle and orchestrator wiring

Using exact field names from `schema-final.md §4.6`.

| Lifecycle event | Command / harness effect |
|---|---|
| Orchestrator decides to invoke an agent | `createAgentRun { agentType, planId, userId }` → `status = 'running'`, `started_at = now()`, `state = null` |
| Agent's first successful `commit(input)` | Atomically with recording the mutation: `state = { last_read_versions: { ...input.readSet } }` |
| Agent's subsequent successful `commit(input)` | Atomically: merge `input.readSet` into existing `last_read_versions`; for a repeated `nodeId`, the **later** observed version overwrites the earlier |
| Agent's `commit(input)` **fails** | `commit` rejects with `CommitFailure`; **neither** the mutation **nor** `last_read_versions` is updated for that call (§10.6) |
| Agent `run()` resolves (success) | `finalizeAgentRun → status = 'completed'`, `completed_at = now()` |
| Agent `run()` rejects/throws (incl. a rejected `commit`) | `finalizeAgentRun → status = 'failed'`, `error = err.message`, `completed_at = now()` |

**`state` jsonb shape** (schema lock decision 7, ADR 0001):

```json
{ "last_read_versions": { "<node-uuid>": 0, "<node-uuid>": 5 } }
```

**Exact `Orchestrator` constructor dependencies:**

```typescript
// apps/api/src/orchestrator/orchestrator.ts  (production — exact)
export interface OrchestratorDeps {
  readonly decomposer: Decomposer;
  readonly graphWrite: OrchestratorGraphWrite;
  readonly snapshotBuilder: GraphSnapshotBuilder;
  readonly agentRegistry: AgentRegistry;
  readonly commitFactory: AgentCommitFactory;
}

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}
  run(request: PlanRequest): Promise<PlanResult>;   // throws OrchestrationError on §6.5 failure
}
```

**Deferred:** stale-input detection on resume (comparing live versions to `last_read_versions`) — RCG-57. `timed_out` status — handling deferred. `token_count` — Python agents/LLM deferred.

---

## 9. Persistence / write-boundary model (reconciled with the graph-write invariant)

**Authoritative statement.** There is **one** logical graph-write seam. Invariant 2 ("all persistent mutations go through graph-write") applies to **all** writers, including the orchestrator. Orchestrator-owned `Plan` and `AgentRun` lifecycle writes are **typed graph-write commands**, not a separate write path. This matches the canonical Python boundary `schema/mutations.py::V31GraphWriteService`, whose `create_plan` / `create_plan_step` methods both apply the row write **and** append a `graph_mutations` audit row inside the same transaction.

The seam is exposed through **two typed ports** onto the same eventual service, differing by actor scope and shape:

| Port | Actor scope | Shape | Spec-05 in-memory double |
|---|---|---|---|
| `OrchestratorGraphWrite` | `orchestrator` | **Typed command methods** (closed by signature) | `InMemoryOrchestratorGraphWrite` (under tests) |
| `AgentCommit` (per run) | one `SpecialistAgentType` | A single `SpecialistMutation` + readSet + key | factory output of `InMemoryAgentCommitFactory` / `CommitStub` (under tests) |

```typescript
// apps/api/src/orchestrator/contracts.ts  (production interface — exact)
import type { AgentType } from "../agents/contracts";

// The orchestrator's closed command contract IS this set of method signatures.
// These are typed commands, not mutation variants — there is no orchestrator `kind`.
export interface OrchestratorGraphWrite {
  createPlan(input: { userId: string; planLineageId: string; queryText: string }): Promise<PlanRecord>;
  transitionPlanStatus(input: { planId: string; toStatus: "current" | "failed" }): Promise<void>;
  createAgentRun(input: { planId: string; userId: string; agentType: AgentType }): Promise<AgentRunRecord>;
  finalizeAgentRun(input: { agentRunId: string; status: "completed" | "failed"; error?: string }): Promise<void>;
}

export interface PlanRecord {
  readonly id: string;
  readonly planLineageId: string;
  readonly revisionNumber: number;       // always 1 in this unit
  readonly queryText: string;
  readonly status: "generating" | "current" | "failed";
  readonly planType: "agent_generated";
}
export interface AgentRunRecord {
  readonly id: string;
  readonly agentType: AgentType;
  readonly planId: string;
  readonly userId: string;
  readonly status: "running" | "completed" | "failed";
  readonly state: { last_read_versions: Record<string, number> } | null;
  readonly error: string | null;
}
```

**Checkpoint ownership and atomicity.** The `agent_runs.state.last_read_versions` checkpoint is orchestrator-owned data, but it is written **inside the specialist commit's transaction** (§10.6), not by a separate orchestrator command — there is deliberately **no** standalone `mergeReadCheckpoint` method that could leave a half-applied state. In the real system, the privileged graph-write process writes the specialist mutation row and the `agent_runs.state` column in one transaction (spec 02: "all in a single transaction"). The `AgentCommitFactory` implementation owns the checkpoint merge by using the bound `agentRunId`; it performs the `agent_runs.state.last_read_versions` update within the same all-or-nothing block as the mutation write. No callback is threaded through the orchestrator.

**Why this does not violate the invariant:** both ports are the single graph-write seam, just actor-scoped. The orchestrator submits only orchestrator commands; specialists submit only specialist-owned mutations. Every write is typed and goes through graph-write.

**Why agents cannot reach the orchestrator port:** `OrchestratorGraphWrite` is injected into the `Orchestrator` constructor only. It appears nowhere on `AgentContext`. Agents hold a `commit` capability bound to their run and restricted to `SpecialistMutation`.

**Interface vs. test repository:** `OrchestratorGraphWrite` and `AgentCommitFactory` are **production interfaces** (the seam). Their spec-05 implementations are **in-memory test doubles** standing in for the eventual `V31GraphWriteService`-backed adapters (spec 02). When spec 02 ships, the real adapters implement these same interfaces; the orchestrator and agents are unchanged.

---

## 10. Typed mutation contract, commit adapter, and in-memory double

### 10.1 Typed specialist mutation union (TEMPORARY — replacement seam in §10.2)

> **TEMPORARY.** This union exists only until the Phase A3 codegen (ADR 0007) emits canonical TypeScript mutation types into `packages/schema-ts/` from `schema/contracts/`. It is **derived from**, and must stay consistent with, the canonical request shapes in `schema/mutations.py`, the literal vocabulary in `schema/generated/types.ts`, and schema-final §4.3–4.4. It introduces **no domain field not already present in the locked schema**. It is **closed**: every variant is exhaustively typed, with **no** `payload: Record<string, unknown>`, **no** `targetTable: string`, and **no** generic value field — so the in-memory adapter can validate every variant exhaustively and no payload can act as a prose channel. When codegen lands, replace this block with a generated import; the `kind`/`stepType` discriminants are chosen to map 1:1 onto the generated variants so no test or public behavior changes.
>
> **Narrow-by-design payloads.** `plan_steps.payload` and `state_dependencies.snapshot_value` are `jsonb` in the locked schema. This unit defines the **narrowest typed representation needed for the spec-05 fixtures**; richer domain payload fields (point amounts, CPP, ranking rationale, multi-leg routes) are **deferred to specs 04/06** and added additively to these variants.

```typescript
// apps/api/src/agents/contracts.ts  (production — TEMPORARY union)

// nodeId → observed version (matches the schema `version` column; integer ≥ 0)
export type ReadSet = Readonly<Record<string, number>>;

// Specialist mutation kinds ONLY. Orchestrator writes are typed methods (§9), not kinds.
export type SpecialistMutationKind =
  | "UpdateUserBalance"        // wallet-owned
  | "CreatePlanStep"           // earning/redemption-owned
  | "RecordStateDependency";   // redemption-owned

export type SpecialistMutation =
  | UpdateUserBalanceMutation
  | CreatePlanStepMutation
  | RecordStateDependencyMutation;

// --- wallet ---
export interface UpdateUserBalanceMutation {
  readonly kind: "UpdateUserBalance";
  readonly balanceNodeId: string;     // user_balances.id
  readonly balancePoints: number;     // integer ≥ 0 (domain check is spec 02 / wallet spec)
}

// --- plan steps: payload discriminated by stepType (schema-final §4.3 CHECK) ---
interface BaseCreatePlanStep {
  readonly kind: "CreatePlanStep";
  readonly planId: string;
  readonly stepOrder: number;         // integer ≥ 1
}
export type CreatePlanStepMutation =
  | (BaseCreatePlanStep & { readonly stepType: "card_assignment";          readonly payload: CardAssignmentPayload })
  | (BaseCreatePlanStep & { readonly stepType: "spend_analysis";           readonly payload: SpendAnalysisPayload })
  | (BaseCreatePlanStep & { readonly stepType: "redemption_recommendation"; readonly payload: RedemptionRecommendationPayload })
  | (BaseCreatePlanStep & { readonly stepType: "transfer_recommendation";  readonly payload: TransferRecommendationPayload });

// Narrowest spec-05 payloads — every field is an id reference to a schema NodeType.
export interface CardAssignmentPayload          { readonly cardId: string }                                   // CreditCard.id
export interface SpendAnalysisPayload           { readonly spendCategoryId: string; readonly recommendedCardId: string } // SpendCategory.id, CreditCard.id
export interface RedemptionRecommendationPayload { readonly redemptionOptionId: string; readonly sourceProgramId: string } // RedemptionOption.id, RewardProgram.id
export interface TransferRecommendationPayload  { readonly fromProgramId: string; readonly toProgramId: string }          // RewardProgram.id × 2

// --- state dependency: closed target + typed snapshot (schema-final §4.4, MVP staleness scope B2) ---
export interface RecordStateDependencyMutation {
  readonly kind: "RecordStateDependency";
  readonly planStepId: string;
  readonly targetNodeId: string;
  readonly observedVersion: number;   // integer ≥ 0
  readonly target: StateDependencyTarget;   // closed union — NOT an arbitrary record
}

// MVP staleness scope (schema-final §4.4 B2): personal-tier nodes only.
export type StateDependencyTarget =
  | { readonly targetNodeType: "UserBalance";       readonly targetTable: "user_balances";
      readonly dependedProperty: "balance_points";  readonly snapshotValue: { readonly balancePoints: number } }
  | { readonly targetNodeType: "UserProgramStatus"; readonly targetTable: "user_program_statuses";
      readonly dependedProperty: "status_tier";     readonly snapshotValue: { readonly statusTier: string } };
```

### 10.2 The commit adapter factory (exact production interface)

```typescript
// apps/api/src/agents/contracts.ts  (production — exact)

export interface AgentCommitFactory {
  create(binding: AgentCommitBinding): AgentCommit;
}

export interface AgentCommitBinding {
  readonly userId: string;
  readonly planId: string;
  readonly agentRunId: string;
  readonly agentType: SpecialistAgentType;
  // No callback. The factory owns the AgentRun.state.last_read_versions merge
  // using agentRunId. The production adapter writes the checkpoint in the same
  // database transaction as the mutation (§10.6); the in-memory adapter applies
  // both in one all-or-nothing block with rollback on failure.
}

// Agent-facing capability. Resolves on success; REJECTS with CommitFailure on
// any failure (§10.3). Accepts only SpecialistMutation (no orchestrator command
// is nameable here).
export type AgentCommit = (input: AgentCommitInput) => Promise<CommitSuccess>;

export interface AgentCommitInput {
  readonly mutation: SpecialistMutation;
  readonly readSet: ReadSet;
  readonly idempotencyKey: string;   // non-empty; e.g. `${agentRunId}:${callCounter}`
}

export interface CommitSuccess {
  readonly mutationTxnId: string;
  readonly idempotencyReplayed: boolean;   // true when this was an idempotent replay (§10.5)
}
```

The factory binds `userId/planId/agentRunId/agentType`; the returned `AgentCommit` has every piece of context required to enforce ownership, run idempotency, write the checkpoint atomically (using the bound `agentRunId` — see §10.6), and propagate failure. The agent supplies only `{ mutation, readSet, idempotencyKey }`.

### 10.3 Commit-failure propagation (exact contract)

A failed commit is **indistinguishable, at the harness level, from a thrown agent error.** The agent-facing `AgentCommit` **rejects** (throws) a typed `CommitFailure`; the orchestrator's `try/catch` around `agent.run(ctx)` catches it and runs the single failure path (§3 step 5h).

```typescript
// apps/api/src/agents/contracts.ts  (production — exact)
export type CommitFailureKind =
  | "ValidationError"      // structural/contract failure at the commit boundary (§12), incl. unknown kind
  | "OwnershipError"       // known mutation kind not owned by the calling agentType (§6.4)
  | "ConflictError"        // OCC version conflict (real path; not triggered by the stub — §10.6)
  | "IdempotencyConflict"  // same key + different request fingerprint → 409 (§10.5)
  | "UnexpectedCommitError"; // includes atomic mutation+checkpoint write failure (§10.6)

export class CommitFailure extends Error {
  constructor(
    readonly kind: CommitFailureKind,
    message: string,
    readonly detail?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "CommitFailure";
  }
}
```

Lifecycle consequences of a failed commit (each named-tested in §16):
- Neither the mutation nor the read checkpoint is applied (atomic, §10.6). — T6, T21
- The current `AgentRun` is finalized `failed` with `error = failure.message`. — T7
- The `Plan` is transitioned to `failed`. — T8
- Remaining agents are **not** invoked. — T9
- A thrown (non-commit) agent error produces the identical lifecycle. — T10

It is **impossible for a failed commit to leave an `AgentRun` `completed`**, because `commit` rejects rather than returning a failure result, and the orchestrator only finalizes `completed` after `run()` resolves.

**Lifecycle cleanup persistence (best-effort vs critical).** On the failure path the orchestrator first attempts `finalizeAgentRun(failed)` (best-effort — errors are recorded in `cleanupErrors` but do not block the primary failure), then **must** succeed at `transitionPlanStatus(failed)` before returning `PlanResult { status: "failed" }`. If `transitionPlanStatus(failed)` throws, the orchestrator propagates that error rather than returning a failed result while the plan remains `generating` in storage. When `finalizeAgentRun(failed)` itself throws during cleanup, the `AgentRun` may remain `running` with `error = null` even though the plan is transitioned to `failed` — the primary agent error is preserved and not overwritten. This is an accepted spec-compliant limitation for this unit (no retry/fallback); durable recovery belongs to spec 02's real adapters. See `context/progress-tracker.md` (Spec 05 gotcha).

| Failure | Stub behavior | Real-path owner |
|---|---|---|
| Validation (malformed structure / unknown kind at boundary) | `CommitFailure("ValidationError")`, no record | spec 05 contract validation (§12) |
| Ownership (known but unowned `kind`) | `CommitFailure("OwnershipError")`, no record | spec 05 (§6.4) |
| OCC conflict | **not** simulated by the stub | spec 02 (real OCC + retry) |
| Idempotency conflict (same key, different fingerprint) | `CommitFailure("IdempotencyConflict")`, no record | spec 05 call-level (§10.5); spec 02 owns `idempotency_records` |
| Idempotent replay (same key, same fingerprint) | **success**, `idempotencyReplayed: true`, recorded once | spec 02 `idempotency_records` |
| Atomic mutation+checkpoint write failure | `CommitFailure("UnexpectedCommitError")`, nothing persisted (§10.6) | both (spec 02 transaction; stub all-or-nothing) |

### 10.4 (reserved)

*Idempotency is §10.5; the atomic write contract is §10.6.*

### 10.5 Idempotency (aligned with schema-final §5.3 / invariant 13)

Semantics are **decided** by the locked schema — this unit does not invent them:

- **Same key + equivalent request (same fingerprint):** the original successful outcome is **replayed** — `commit` resolves with the prior `CommitSuccess` and `idempotencyReplayed: true`. The mutation is recorded **exactly once**; the checkpoint merge (§10.6) does **not** run again.
- **Same key + different request (different fingerprint):** rejected with `CommitFailure { kind: "IdempotencyConflict" }` (the in-process analogue of the schema's 409). No state change.
- **Empty/invalid idempotency key:** rejected with `CommitFailure { kind: "ValidationError" }`.

The stub derives the request fingerprint deterministically from the typed mutation (canonical stable serialization over the closed variant). It models the `(idempotency_key → fingerprint, prior result)` mapping **at the call level only**.

**Deferred to spec 02 (non-blocking):** the durable `idempotency_records` table, the persisted `request_hash`, and `(user_id, operation_type, idempotency_key)` scoping. No downstream agent code depends on the stub's in-memory fingerprinting — agents observe only `CommitSuccess` (with `idempotencyReplayed`) or a thrown `CommitFailure`, which the real path produces identically.

### 10.6 Atomic mutation + checkpoint write (exact contract)

**Design: atomic (matches spec 02's "single transaction").** A successful `commit` applies the specialist mutation **and** the `last_read_versions` checkpoint merge as one all-or-nothing unit:

1. Validate (§12), enforce ownership (§6.4), resolve idempotency (§10.5).
2. In one atomic block: record the mutation **and** write the `last_read_versions` merge into `agent_runs.state` using the bound `agentRunId`.
3. Resolve `commit` with `CommitSuccess`.

**If the checkpoint merge (step 2) fails after the mutation would have been recorded:** the in-memory double **rolls back** the recorded mutation so **neither** the mutation **nor** the checkpoint persists, and `commit` rejects with `CommitFailure { kind: "UnexpectedCommitError" }`. The `AgentRun` is then finalized `failed` (§10.3). There is no partial state: a caller never observes a recorded mutation without its checkpoint, or a checkpoint without its mutation.

**Real path (spec 02):** the privileged graph-write process writes the specialist mutation row and the `agent_runs.state` column in the **same database transaction**; either both commit or both roll back. The `idempotencyKey` makes a retry after a transaction failure safe (replay or clean re-apply). Because atomicity holds, this unit does **not** define a partial-success recovery procedure — there is no partial success to recover.

### 10.7 In-memory commit double (`InMemoryAgentCommitFactory` / `CommitStub`) — under tests

The double is a faithful **contract** double, not a database emulator. Before recording a commit it performs the validation in §12, enforces ownership (§6.4), applies idempotency (§10.5), and records the mutation + checkpoint atomically (§10.6).

**What it does NOT emulate** (owned elsewhere):
- OCC version-conflict detection and retry — spec 02.
- Per-user advisory lock (ADR 0008) — spec 02.
- `graph_mutations` / `idempotency_records` / `replan_jobs` row insertion and staleness propagation — spec 02.
- Domain rules (balance ≥ 0, transfer route exists, etc.) — spec 02 / specialist specs.
- Persistence across process restarts.

Observable state for assertions: the ordered list of recorded commits, the set of seen idempotency keys with fingerprints, per-key prior results, and a test seam (`failCheckpointOnce`) to simulate an atomic-write failure for T21.

---

## 11. Deterministic acceptance fixture

### Persona query

```
"What's the best use of my Chase Ultimate Rewards for a Tokyo trip in October?"
```

### Stub snapshot (operation targets must resolve against it)

```typescript
const tokyoSnapshot: GraphSnapshot = {
  userBalances: [
    { id: "balance-chase-ur", programId: "program-chase-ur", balancePoints: 85000, version: 2 },
    { id: "balance-amex-mr",  programId: "program-amex-mr",  balancePoints: 40000, version: 1 },
  ],
  userGoals: [
    { id: "goal-1", goalType: "specific_redemption", targetRedemptionOptionId: "option-hyatt-tokyo" },
  ],
  userProgramStatuses: [],
};
```

### Fake decomposition output (typed operations)

```typescript
const tokyoFixture: DecomposedQuery = {
  invocations: [
    { agentType: "wallet_agent", operation: {
        kind: "assess_wallet", agentType: "wallet_agent",
        programIds: ["program-chase-ur"] } },
    { agentType: "earning_agent", operation: {
        kind: "recommend_earning", agentType: "earning_agent",
        spendCategoryIds: ["category-travel"] } },
    { agentType: "redemption_agent", operation: {
        kind: "traverse_redemption", agentType: "redemption_agent",
        goalType: "specific_redemption",
        targetRedemptionOptionId: "option-hyatt-tokyo",
        sourceProgramIds: ["program-chase-ur"] } },
  ],
};
```

### Registered fake agents (under tests) — behavior derived from the typed operation

Each fake agent **reads its operation** to choose its committed mutation; it does not hard-code the target.

```typescript
class FakeWalletAgent implements Agent<"wallet_agent"> {
  readonly agentType = "wallet_agent" as const;
  async run(ctx: AgentContext<"wallet_agent">): Promise<void> {
    // target balance selected FROM the operation's first programId
    const programId = ctx.operation.programIds[0];
    const target = ctx.snapshot.userBalances.find((b) => b.programId === programId);
    if (!target) throw new Error(`wallet_agent: no balance for ${programId}`);
    await ctx.commit({
      mutation: { kind: "UpdateUserBalance", balanceNodeId: target.id, balancePoints: target.balancePoints },
      readSet: { [target.id]: target.version },
      idempotencyKey: `${ctx.agentRunId}:0`,
    });
  }
}

class FakeEarningAgent implements Agent<"earning_agent"> {
  readonly agentType = "earning_agent" as const;
  async run(ctx: AgentContext<"earning_agent">): Promise<void> {
    // payload's spendCategoryId derived FROM the operation
    await ctx.commit({
      mutation: { kind: "CreatePlanStep", planId: ctx.planId, stepOrder: 1, stepType: "spend_analysis",
        payload: { spendCategoryId: ctx.operation.spendCategoryIds[0], recommendedCardId: "card-csp" } },
      readSet: { "balance-chase-ur": 2, "card-csp": 0 },
      idempotencyKey: `${ctx.agentRunId}:0`,
    });
  }
}

class FakeRedemptionAgent implements Agent<"redemption_agent"> {
  readonly agentType = "redemption_agent" as const;
  async run(ctx: AgentContext<"redemption_agent">): Promise<void> {
    // payload derived FROM the operation's redemption target + source program
    await ctx.commit({
      mutation: { kind: "CreatePlanStep", planId: ctx.planId, stepOrder: 2, stepType: "redemption_recommendation",
        payload: {
          redemptionOptionId: ctx.operation.targetRedemptionOptionId ?? "option-unspecified",
          sourceProgramId: ctx.operation.sourceProgramIds[0] } },
      readSet: { "balance-chase-ur": 2, "route-chase-hyatt": 5 },
      idempotencyKey: `${ctx.agentRunId}:0`,
    });
  }
}
```

### Expected outcome (all agents succeed)

- Invocation order: `wallet_agent` → `earning_agent` → `redemption_agent` (array index 0 → 1 → 2).
- One `Plan`: `revision_number = 1`, `status = 'current'`, `query_text = <persona query>`, `plan_type = 'agent_generated'`, stable generated `plan_lineage_id`.
- Three `AgentRun` rows, all `completed`, with merged `last_read_versions`:
  - `wallet_agent` → `{ "balance-chase-ur": 2 }`
  - `earning_agent` → `{ "balance-chase-ur": 2, "card-csp": 0 }`
  - `redemption_agent` → `{ "balance-chase-ur": 2, "route-chase-hyatt": 5 }`
- Commit double: 3 recorded commits, in invocation order; 3 distinct idempotency keys.
- Recorded mutations reflect the operations: wallet `balanceNodeId = "balance-chase-ur"`; earning `payload.spendCategoryId = "category-travel"`; redemption `payload.redemptionOptionId = "option-hyatt-tokyo"`, `payload.sourceProgramId = "program-chase-ur"`.

### Operation-coupling fixture (T14)

Reuse `FakeWalletAgent` with an operation whose `programIds[0] = "program-amex-mr"` → the recorded mutation's `balanceNodeId` becomes `"balance-amex-mr"` and the readSet `{ "balance-amex-mr": 1 }`. Same agent code, different operation, **different mutation** — proving behavior is operation-driven, not hard-coded.

### Failure fixture — earning_agent fails

```typescript
class FailingEarningAgent implements Agent<"earning_agent"> {
  readonly agentType = "earning_agent" as const;
  async run(_ctx: AgentContext<"earning_agent">): Promise<void> {
    throw new Error("earning_agent_error: external data unavailable");
  }
}
```

**Expected:** wallet runs and commits (`completed`); earning throws (`failed`, `error = 'earning_agent_error: external data unavailable'`); redemption **not invoked** (no `AgentRun` row); `Plan.status = 'failed'`; commit double has exactly 1 recorded commit.

### Ownership / validation / decomposition fixtures (under tests)

- `WalletAgentSubmittingDependency` — wallet agent whose `run` calls `commit` with a `RecordStateDependency` mutation cast through `as unknown as SpecialistMutation` → rejected `OwnershipError`, no record. (T16)
- `SpecialistNamingPlanCommand` — an agent attempting `commit({ mutation: { kind: "CreatePlan", … } as unknown as SpecialistMutation })` → rejected `ValidationError` (unknown specialist kind), no record. (T17); the compile-time exclusion is T32.
- `RawDecomposer` — returns deliberately malformed `DecomposedQuery` values (unknown agentType; unknown operation kind; mismatched agentType/operation; wrong operation kind for agent; missing identifier; unexpected `prompt` key; empty `invocations`) for the §6.5 validation tests (T22–T28).

---

## 12. In-memory commit double — required validation

Before recording any commit, the double **rejects** (with the mapped `CommitFailure` kind) when:

| Condition | `CommitFailure.kind` |
|---|---|
| `mutation.kind` is not a known `SpecialistMutationKind` | `ValidationError` |
| For `CreatePlanStep`: `stepType` not a known step type, or payload keys don't match the variant | `ValidationError` |
| For `RecordStateDependency`: `target` not a known `StateDependencyTarget` variant | `ValidationError` |
| `mutation.kind` is known but not owned by the bound `agentType` (§6.4) | `OwnershipError` |
| A required identifier on the mutation is missing/empty (e.g. empty `balanceNodeId`, `planId`, `planStepId`, payload id) | `ValidationError` |
| Any `readSet` version is negative or non-integer | `ValidationError` |
| `idempotencyKey` is empty or not a string | `ValidationError` |
| `idempotencyKey` seen with a **different** fingerprint | `IdempotencyConflict` |
| Atomic checkpoint merge fails (test seam) | `UnexpectedCommitError` (nothing persisted, §10.6) |

Because every variant is closed (§10.1), validation is **exhaustive**: a `switch` over `kind` (and nested `stepType` / `target`) with a `never` default covers all cases.

**Separation of concerns (do not blur):**
- **Contract validation (spec 05, the double):** structure, closed-variant exhaustiveness, required identifiers, read-set shape, ownership, idempotency-key presence, call-level fingerprint dedup, atomic all-or-nothing.
- **OCC + transaction behavior (spec 02):** version conflicts, advisory lock, audit rows, durable idempotency, staleness.
- **Domain rules (specialist specs):** balance ≥ 0, transfer route validity, ranking math.

---

## 13. Exact implementation plan

Write all test files (step 2) before any production module. The red phase (step 3) must be recorded in `AI_USAGE.md` before any production code is written.

1. **Scaffold `apps/api/`** as a self-contained package: `apps/api/package.json` (TypeScript, Vitest, `@types/node`; `test` + `typecheck` scripts) and `apps/api/tsconfig.json` (`strict`, `ES2022`, `ESNext`/`Bundler` — see §17). A monorepo workspace root (pnpm/turbo) is **out of scope**. No production logic yet. Spec 05 owns this scaffold because it is the **first** TypeScript app code in the repo; `apps/api` is the ADR 0004 / architecture-context-mandated orchestrator location, and no earlier platform-scaffold unit exists.
2. **Write all named tests** (§16) and their helpers/doubles under `apps/api/tests/` (§14). All imports from `src/` are unresolved at this stage — do not create production modules yet.
3. **Red phase.** Run `cd apps/api && npm test -- tests/orchestrator tests/agents`. The run must fail because production modules are absent (unresolved imports or suite-load error). **Record the actual result in `AI_USAGE.md` before writing any production code.**
4. **Define agent contracts** in `apps/api/src/agents/contracts.ts`: `SpecialistAgentType`, `AgentType`, `UserGoalType`, `Agent<K>`, `AgentContext<K>`, `AgentRegistry`, `GraphSnapshot` + row types, `GraphSnapshotBuilder`, `ReadSet`, `SpecialistMutationKind`, `SpecialistMutation` (+ variants + payload interfaces + `StateDependencyTarget`), `AgentCommit`, `AgentCommitInput`, `AgentCommitBinding`, `AgentCommitFactory`, `CommitSuccess`, `CommitFailure`, `CommitFailureKind`.
5. **Define orchestrator contracts** in `apps/api/src/orchestrator/contracts.ts`: `PlanRequest`, `PlanResult`, `Decomposer`, `DecomposedQuery`, `AgentInvocation`, `AgentOperation` (+ variants), `OperationByAgent`, `OrchestratorGraphWrite`, `PlanRecord`, `AgentRunRecord`, `OrchestrationError`, `OrchestrationErrorKind`, `OrchestratorDeps`.
6. **Define ownership** (`apps/api/src/agents/ownership.ts`: `MUTATION_OWNERSHIP`, `isOwnedBy`) and **decomposition validation** (`apps/api/src/orchestrator/decomposition.ts`: `validateDecomposedQuery`).
7. **Write the orchestrator** in `apps/api/src/orchestrator/orchestrator.ts`: `OrchestratorDeps` constructor; implement the exact loop from §3, including decomposition validation, the type-correlated dispatch switch (§6.3), the failure path, and the atomic checkpoint merge.
8. **Run targeted tests green, then typecheck**, then the full `apps/api` suite (§17).

The orchestrator depends **only on the interfaces** in steps 4–6. Every concrete implementation in this unit is an in-memory **test double** under `apps/api/tests/`. There is therefore no production "stub" module and no production wiring/composition root in this unit.

---

## 14. Exact file touch list

No wildcard paths. No "or define here" alternatives. One canonical production location per type; all doubles under the test tree.

### New production files

| Path | Contents |
|---|---|
| `apps/api/package.json` | Package: TypeScript, Vitest, `@types/node`; `test` + `typecheck` scripts |
| `apps/api/tsconfig.json` | `strict`, `ES2022`, `ESNext`/`Bundler` (see §17) |
| `apps/api/src/agents/contracts.ts` | Agent + mutation + commit contracts (step 2). **Canonical** location |
| `apps/api/src/agents/ownership.ts` | `MUTATION_OWNERSHIP`, `isOwnedBy` |
| `apps/api/src/orchestrator/contracts.ts` | Orchestrator + decomposition + graph-write-port contracts (step 3). **Canonical** location |
| `apps/api/src/orchestrator/decomposition.ts` | `validateDecomposedQuery` (§6.5) |
| `apps/api/src/orchestrator/orchestrator.ts` | `Orchestrator` class (the loop) |

### New test files (all doubles and fixtures live here)

| Path | Contents |
|---|---|
| `apps/api/tests/helpers/fake-decomposer.ts` | `FakeDecomposer`, `RawDecomposer` |
| `apps/api/tests/helpers/fake-agents.ts` | `FakeWalletAgent`, `FakeEarningAgent`, `FakeRedemptionAgent`, `FailingEarningAgent`, `WalletAgentSubmittingDependency`, `SpecialistNamingPlanCommand` |
| `apps/api/tests/helpers/in-memory-commit.ts` | `InMemoryAgentCommitFactory` (`CommitStub`) — validation, ownership, idempotency, atomic write + `failCheckpointOnce` seam (§10.7, §12) |
| `apps/api/tests/helpers/in-memory-graph-write.ts` | `InMemoryOrchestratorGraphWrite` — Plan/AgentRun lifecycle + one-current enforcement (§9, §7) |
| `apps/api/tests/helpers/stub-snapshot-builder.ts` | `StubGraphSnapshotBuilder` — fixture `GraphSnapshot` (§11) |
| `apps/api/tests/orchestrator/orchestrator.test.ts` | T1–T14 |
| `apps/api/tests/orchestrator/commit-ownership.test.ts` | T15–T21 |
| `apps/api/tests/orchestrator/decomposition.test.ts` | T22–T28 |
| `apps/api/tests/agents/agent-harness.test.ts` | T29–T32 (type-level) |

### Documentation / bookkeeping touched by the implementer

| Path | Change |
|---|---|
| `context/feature-specs/05-orchestrator-harness.md` | This spec (already corrected) |
| `context/progress-tracker.md` | Implementer updates "In progress" on start and "Completed" on done |
| `AI_USAGE.md` | Implementer appends the implementation entry (completion gate §19) |

### Explicitly excluded — do not touch

| Path | Reason |
|---|---|
| `STATUS.md` | Human-maintained standup board (AGENTS.md "daily team visibility"). **Excluded.** |
| `tracking/` | Per-person daily tracking, human-maintained. **Excluded.** |
| `schema/schema.sql`, `schema/contracts/`, `schema/generated/`, `schema/mutations.py`, `schema/types.py` | Locked / generated (ADR 0001, 0007). No schema or contract change in this unit |
| `packages/schema-ts/` | Phase A3 codegen target (ADR 0007); not built in this unit |
| `apps/api/src/graph/`, `apps/api/src/agents/launcher.ts` | Spec 02 / launcher lane; not created here |
| `apps/web/` | Frontend — Val's lane |
| `agents/` | Python specialist agents — specs 04/06 |
| `tests/*.py`, `schema/experimental/polymorphic/*` | Pre-lock Python prototype; do not reference or adapt |
| `context/feature-specs/02-*.md`, `03-*.md`, `04-*.md`, `06-*.md` | Other specs — do not modify |
| Any other file | **Stop** — record a blocker (§18), leave the spec `In Progress`, do not expand scope |

**STATUS.md / tracking/ resolution:** explicitly **excluded** from the implementation touch list. This spec's exhaustive list overrides the general "update your row in STATUS.md / tracking/" bookkeeping guidance in AGENTS.md for automated implementation runs; those files are maintained by humans in the standup flow. No new dependency (e.g. a runtime-schema library) is added — `validateDecomposedQuery` is a manual type guard.

---

## 15. Acceptance criteria

- [ ] A persona query produces exactly one `Plan` (`generating → current`) and one `AgentRun` per decomposed invocation, in order.
- [ ] Each agent receives the typed `operation` whose `agentType` equals its own, narrowed by `AgentContext<K>` (T2, T31).
- [ ] A fake agent's recorded mutation is derived from its operation; changing the operation changes the mutation (T13, T14).
- [ ] No public field on `AgentInvocation` carries free text (T29); `AgentContext` injects no DB/HTTP/bus/peer/callback (T30); orchestrator commands are not nameable through `commit` (T32).
- [ ] Decomposer output is validated before any `AgentRun`; unknown/mismatched/malformed/empty decompositions throw `OrchestrationError`, create no `AgentRun`, and leave the Plan `failed` (T22–T28).
- [ ] Each successful agent run records `last_read_versions` equal to the merged `readSet` values from its successful commits (later version wins per node), applied atomically with the mutation.
- [ ] A failed commit persists neither the mutation nor the checkpoint; a checkpoint-write failure rolls back the mutation (T6, T21).
- [ ] The harness runs end to end on in-memory doubles — no DB, no live LLM.
- [ ] A thrown agent error **or** a rejected commit causes `AgentRun → failed`, `Plan → failed`, and halts remaining agents.
- [ ] Unknown/unowned mutations are rejected before any state change; a specialist cannot create/transition a `Plan`.
- [ ] Idempotency follows schema-final §5.3: same key + same request → replay; same key + different request → conflict.
- [ ] `npm run typecheck` and `npm test` in `apps/api` both pass; no named test skipped.
- [ ] No invariant from `context/architecture-context.md` is violated.

---

## 16. Named tests

Author each test before the production module it exercises. Names are exact.

### `apps/api/tests/orchestrator/orchestrator.test.ts`

| ID | Test name | Type | Proves |
|---|---|---|---|
| T1 | `decomposes a persona query into ordered typed operations` | integration | Validated output is an ordered `AgentInvocation[]` of typed operations |
| T2 | `passes each agent the typed operation matching its own agent type` | unit | For every run, `ctx.operation.agentType === agent.agentType` |
| T3 | `creates one Plan generating then current with one ordered AgentRun per invocation` | integration | Happy path: Plan lifecycle + 3 ordered runs |
| T4 | `records last_read_versions from readSet on first successful commit` | unit | Checkpoint equals first commit's `readSet` |
| T5 | `merges last_read_versions across multiple commits in one run` | unit | Overlapping key takes later version; non-overlapping keys both kept |
| T6 | `persists neither mutation nor checkpoint when a commit fails` | unit | Rejected commit leaves recorded set and `last_read_versions` unchanged |
| T7 | `marks the AgentRun failed when a commit fails` | unit | Rejected commit → `AgentRun.status = 'failed'`, error recorded |
| T8 | `marks the Plan failed when a required commit fails` | unit | Rejected commit → `Plan.status = 'failed'` |
| T9 | `does not invoke later agents after a failed commit` | unit | No `AgentRun` row for agents after the failure |
| T10 | `treats a thrown agent error like a failed commit` | unit | Failure fixture: identical lifecycle to T7–T9 |
| T11 | `is the only component that creates or transitions Plans` | behavioral | `AgentContext` exposes no graph-write port; only the orchestrator port creates/transitions Plans |
| T12 | `completes the persona flow end to end on in-memory doubles` | integration | Full fixture (§11) green with no DB and no live LLM |
| T13 | `derives each agent's committed mutation from its typed operation` | unit | wallet `balanceNodeId` from `programIds`; earning `spendCategoryId`; redemption `redemptionOptionId`/`sourceProgramId` |
| T14 | `produces a different mutation when the operation changes` | unit | Same wallet agent + `program-amex-mr` operation → `balanceNodeId = 'balance-amex-mr'` |

### `apps/api/tests/orchestrator/commit-ownership.test.ts`

| ID | Test name | Type | Proves |
|---|---|---|---|
| T15 | `rejects an unknown mutation variant before any state change` | unit | Unknown `kind` → `ValidationError`; nothing recorded |
| T16 | `rejects a wallet agent submitting a redemption-owned mutation` | unit | wallet → `RecordStateDependency` → `OwnershipError`; nothing recorded |
| T17 | `rejects a specialist naming a Plan command` | unit | specialist → `{kind:'CreatePlan'}` (via cast) → `ValidationError`; nothing recorded |
| T18 | `replays the original result for the same key and equivalent request` | unit | Same key + same fingerprint → `idempotencyReplayed: true`; recorded once |
| T19 | `rejects the same key with a different request as an idempotency conflict` | unit | Same key + different fingerprint → `IdempotencyConflict`; no state change |
| T20 | `rejects invalid identifiers, read-set versions, and empty idempotency keys` | unit | §12 contract validation → `ValidationError`; nothing recorded |
| T21 | `rolls back the mutation when the atomic checkpoint merge fails` | unit | `failCheckpointOnce` → `UnexpectedCommitError`; neither mutation nor checkpoint persisted; run failed |

### `apps/api/tests/orchestrator/decomposition.test.ts`

| ID | Test name | Type | Proves |
|---|---|---|---|
| T22 | `rejects an unknown agentType in decomposer output` | unit | → `OrchestrationError('DecompositionInvalid')` |
| T23 | `rejects an unknown operation kind` | unit | → `DecompositionInvalid` |
| T24 | `rejects an invocation whose agentType does not match its operation` | unit | mismatch → `DecompositionInvalid` |
| T25 | `rejects an operation kind not valid for the declared agent` | unit | e.g. wallet + `traverse_redemption` → `DecompositionInvalid` |
| T26 | `rejects an unexpected free-text key on an invocation or operation` | unit | stray `prompt` key → `DecompositionInvalid` |
| T27 | `rejects an empty invocation sequence` | unit | empty `invocations` → `DecompositionInvalid` |
| T28 | `creates no AgentRun and fails the Plan on decomposition validation failure` | integration | Plan `generating → failed`; zero `AgentRun` rows; zero commits; throws |

### `apps/api/tests/agents/agent-harness.test.ts` (type-level)

| ID | Test name | Type | Proves |
|---|---|---|---|
| T29 | `rejects a free-text field on AgentInvocation at compile time` | type-level (`@ts-expect-error`) | `{ agentType: 'wallet_agent', operation: …, prompt: 'x' }` is a compile error |
| T30 | `exposes only the declared capabilities on AgentContext` | type-level (`@ts-expect-error`) | `ctx.db`, `ctx.http`, `ctx.bus`, `ctx.otherAgents`, `ctx.commitFactory` are compile errors |
| T31 | `binds each agent type to exactly its operation type` | type-level (`@ts-expect-error`) | An `Agent<"wallet_agent">` whose `run` reads a `RedemptionTraversalOperation` field, or is handed an `earning` operation, is a compile error |
| T32 | `excludes orchestrator commands from the agent-facing commit at compile time` | type-level (`@ts-expect-error`) | `commit({ mutation: { kind: 'CreatePlan', … } })` is a compile error (no orchestrator mutation type in `SpecialistMutation`) |

**Type-level pattern.** Each `@ts-expect-error` is asserted by `tsc --noEmit`: if the prohibited construct becomes valid, TypeScript emits `TS2578` (unused `@ts-expect-error`) and `typecheck` fails. The runtime body asserts nothing beyond compilation (`expect(true).toBe(true)`).

**Test count:** 32 named tests across 4 files. Categories: decomposition typing + operation coupling (T1, T2, T13, T14, T29, T31); happy-path lifecycle (T3–T5, T11, T12); failure lifecycle + atomicity (T6–T10, T21); commit ownership / idempotency / contract validation (T15–T20, T32); decomposition trust-boundary validation (T22–T28).

---

## 17. Automated verification

### Package setup (run once)

`apps/api/package.json` scripts:

```json
{
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`apps/api/tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "rootDir": ".",
    "skipLibCheck": true
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

**Why `Bundler` resolution instead of `NodeNext`:** `NodeNext` requires `.js` extensions on every relative TypeScript import at runtime (e.g. `import … from "../agents/contracts.js"`). Since this package is consumed only by Vitest (not a Node ESM runtime), `Bundler` resolution is the correct choice — it aligns with how Vitest actually resolves modules and avoids the extension-mismatch class of implementation-time errors.

Install dev deps (`typescript`, `vitest`, `@types/node`) at implementation time.

### Red phase (before the production modules exist)

```bash
cd apps/api && npm test -- tests/orchestrator tests/agents
```

**Expected red result (record the actual outcome in `AI_USAGE.md`):** the run **fails**. Because the production modules under `src/` are not yet present, the suites fail to load (unresolved imports). An unresolved-import / suite-load failure **counts as red** — there is no requirement that the runner report a specific number of individual assertion failures before the modules exist.

### Green phase (after each module)

```bash
cd apps/api && npm test -- tests/orchestrator/orchestrator.test.ts
cd apps/api && npm test -- tests/orchestrator/commit-ownership.test.ts
cd apps/api && npm test -- tests/orchestrator/decomposition.test.ts
cd apps/api && npm test -- tests/agents/agent-harness.test.ts
```

### Typecheck

```bash
cd apps/api && npm run typecheck
```

### Final gate

```bash
cd apps/api && npm run typecheck && npm test
```

**Required semantic outcomes** (do not assert exact runner summary text — formatting varies by Vitest version):
- Targeted spec-05 tests pass.
- The full `apps/api` suite passes.
- No named test (T1–T32) is skipped.
- `typecheck` reports no errors.
- The actual commands and their outcomes are logged in `AI_USAGE.md`.

### Failure handling

| Situation | Response |
|---|---|
| A named test fails | Fix only the production code; do not alter the test's assertions |
| Typecheck fails on spec-05 source | Fix the type; do not weaken `strict` |
| `@ts-expect-error` (T29–T32) emits `TS2578` | The prohibited construct is valid — fix the **type definition**, not the test |
| Implementation needs a file not in §14 | **Stop.** Record a blocker (§18), leave the spec `In Progress` |
| The temporary mutation union conflicts with new spec 02 / codegen decisions | Stop; coordinate with the spec 02 / codegen owner (Alan). Replace the union behind the same `AgentCommit`/`AgentCommitFactory` seam only |

---

## 18. Manual verification

No separate verification script and no `tsx` dependency. Manual verification uses **only** files and tooling already in the §14 touch list, and is a **code-and-result review** — the verbose reporter confirms T12 *passed*; it does not by itself print internal Plan/AgentRun values.

Procedure:

1. Run the end-to-end test with the verbose reporter:
   ```bash
   cd apps/api && npm test -- tests/orchestrator/orchestrator.test.ts --reporter=verbose
   ```
   Confirm **T12** (`completes the persona flow end to end on in-memory doubles`) is reported **passed**.
2. Open the committed T12 assertion block in `apps/api/tests/orchestrator/orchestrator.test.ts` and confirm by reading the assertions that they cover, against the §11 fixture:
   - Plan status `generating → current`;
   - invocation order `wallet_agent → earning_agent → redemption_agent`;
   - all three `AgentRun` rows `completed` with the expected merged `last_read_versions`;
   - the commit double recorded exactly 3 commits;
   - the recorded mutations match the operation-derived values (§11 "Expected outcome").
3. Record this code-and-result review (file, test name, confirmed assertions, pass result) in `AI_USAGE.md`.

No grep-based "architectural" check is required — the typed-coordination guarantees are proven by T29–T32 (compile-time), T15–T17 (runtime ownership), and T22–T28 (decomposition validation), not by text search.

---

## 19. Completion gate

Mark this spec `Done` only when **all** are true:

- [ ] Spec status moved from `In Progress` to `Done` in the header.
- [ ] All named tests (T1–T32) authored before their production modules and now passing.
- [ ] `cd apps/api && npm run typecheck && npm test` passes; no named test skipped.
- [ ] Manual verification (§18) performed; observed outcomes match §11.
- [ ] `context/progress-tracker.md` updated (one "Completed" line with files touched and any gotcha).
- [ ] `AI_USAGE.md` updated with: tools used; key decisions (temporary mutation union mapping, per-step typed payloads, `StateDependencyTarget` closure, `Agent<K>` coupling, decomposition validation, atomic checkpoint, orchestrator-command-vs-mutation model); the **actual** red-phase result; validation commands and their real outcomes; surprises; deferred/blocked work discovered.
- [ ] No file outside §14 changed; no schema/contract/generated file changed.
- [ ] Work stops after this spec; do **not** start spec 06.

**The gate is not cleared until `AI_USAGE.md` is updated.**

---

## 20. Open questions and explicit resolutions

| # | Question | Blocking? | Resolution |
|---|---|---|---|
| 1 | Canonical generated TypeScript mutation types (Phase A3 codegen, ADR 0007) | **No (deferred dependency)** | This unit ships the closed temporary `SpecialistMutation` union (§10.1), derived from `schema/mutations.py` + `schema/generated/types.ts` + schema-final §4.3–4.4, with discriminants chosen to map 1:1 onto the future generated variants. Replacement seam: replace the union with a generated import from `packages/schema-ts/`; no orchestrator, agent, or test change. |
| 2 | Spec 02 real write path (OCC, advisory lock, `graph_mutations`, durable idempotency, single-txn atomicity) | **No (deferred dependency)** | Reached only through `AgentCommitFactory` / `OrchestratorGraphWrite`. In-memory doubles implement the spec-05 contract fully, including atomic mutation+checkpoint (§10.6); spec 02 supplies the real adapters behind the same interfaces. |
| 3 | Python subprocess protocol for specialist agents | **No** | Out of scope. The TS `Agent<K>` interface drives deterministic stubs here; the subprocess contract (`launcher.ts`, env allowlist, no `DATABASE_URL`) is ADR 0007 / specs 04–06 (invariant 11). |
| 4 | LLM-backed `Decomposer` | **No** | Out of scope; the `Decomposer` interface is the seam. Because the implementation is untrusted, its output is validated by `validateDecomposedQuery` (§6.5) regardless of which implementation produces it. |
| 5 | Test runner | **No** | Vitest (TypeScript-native; supports `@ts-expect-error` via `tsc --noEmit`; `npm test -- <pattern>`). |
| 6 | Monorepo workspace root (pnpm/turbo) | **No** | Out of scope. `apps/api` is scaffolded as a self-contained package; a workspace root is a later infra task. `apps/api` itself is the ADR 0004 / architecture-context-mandated location, and spec 05 is the first TS unit, so it owns the scaffold. |
| 7 | Richer plan-step / state-dependency domain payloads, and world-graph snapshot fields (transfer routes, earn edges) | **No** | Personal-tier, narrowest fixture payloads only in this unit; the payload interfaces and `GraphSnapshot` type are extended additively by specs 04/06. |
