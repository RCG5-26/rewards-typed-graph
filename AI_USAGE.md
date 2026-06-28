# AI Usage Log — Rewards Agent (gpFree)

> Records AI-assisted work in this repository. Each entry documents what tools were used, what decisions were made, and what was validated or deferred. This file is required by the completion gate of each feature spec.

---

## Entry 001 — Spec 05 Hardening (2026-06-22)

**Task:** Spec-hardening of `context/feature-specs/05-orchestrator-harness.md`
**Branch:** `raq/orchestrator-harness`
**Files modified:** `context/feature-specs/05-orchestrator-harness.md`, `AI_USAGE.md` (this file, created)
**Production code changed:** No

### Tools used

- Claude Code (Sonnet 4.6) — full spec audit and rewrite
- `Read` tool — 15+ repository files read in order specified by AGENTS.md
- `Bash` tool — directory listings, file discovery, git status inspection

### Repository files inspected

Read in order per AGENTS.md:

1. `AGENTS.md` · 2. `context/project-overview.md` · 3. `context/architecture-context.md`
2. `context/design-context.md` · 5. `context/code-standards.md` · 6. `context/ai-workflow-rules.md`
3. `context/decisions-log.md` · 8. `context/risks-and-failure-modes.md` · 9. `context/progress-tracker.md`
4. `context/feature-specs/05-orchestrator-harness.md` · 11. `context/feature-specs/02-graph-write-path.md`
5. `context/feature-specs/04-redemption-traversal.md` · 13. `context/feature-specs/06-wallet-and-earning-agents.md`
6. `README.md` · 15. `STATUS.md` · 16. `docs/architecture/schema-final.md` · 17. `schema/schema.sql`
7. `docs/adr/0001-schema-lock.md` · 19. `docs/adr/0002-mvp-scope-trim.md`

Also inspected: root directory listing, `tests/` directory, `agents/` directory, find for package.json/tsconfig.json/pyproject.toml, first 40 lines of `tests/test_mutations.py`.

### Key ambiguities resolved

1. **Orchestrator boundary:** Input/output types, Plan creation ownership, sequential vs parallel orchestration, agent failure halt behavior — all made explicit with exact TypeScript interface shapes.

2. **Natural-language decomposition:** Defined `Decomposer` interface with `decompose(queryText)`. Explicitly prohibited fields on `AgentInvocationSpec` (no prompt, message, instructions). `FakeDecomposer` pattern for tests. LLM decomposer is a future spec.

3. **Agent harness capability:** `AgentContext` interface with exactly `planId, userId, agentRunId, snapshot, commit`. TypeScript type system enforces no DB/HTTP/agent-reference fields. `@ts-expect-error` tests prove structural impossibility of free-text coordination.

4. **Commit contract (temporary):** `CommitFn` / `CommitStub` defined in spec §10. Adapter seam at `apps/api/src/agents/commit-adapter.ts`. Spec 02 final alignment deferred.

5. **AgentRun lifecycle:** Exact schema field names from `agent_runs` table: `state` jsonb stores `{ last_read_versions: { [nodeId]: version } }`. Checkpoint written on first commit, merged on subsequent commits. Stale-input detection deferred.

6. **Plan lifecycle:** Status sequence `generating → current` (success) or `generating → failed` (any agent failure). PlanSteps not created in spec 05.

7. **Test paths:** TypeScript tests go in `apps/api/tests/orchestrator/` (not root `tests/`) because root `tests/` already contains Python `unittest` files using the pre-lock polymorphic schema prototype — mixing test runners would conflict. Spec 02's `tests/graph/write-path.*` should be interpreted as `apps/api/tests/graph/write-path.*`.

8. **Test runner:** Vitest (TypeScript-native; no config needed; supports `@ts-expect-error` type-level tests). Consistent with `npm test -- <pattern>` convention in specs 02 and 05.

9. **STATUS.md / tracking/ ownership:** Explicitly excluded from implementation agent touch list. Human-maintained standup files.

10. **The experimental Python code in `tests/test_mutations.py`:** Pre-lock polymorphic-node prototype (`schema.experimental.polymorphic`). Spec 05 builds against the locked table-per-type schema; this code is irrelevant and must not be referenced.

### Findings during audit

- `code-standards.md` is a largely unfilled template — implementation agents should match existing TypeScript conventions rather than relying on that file.
- `AI_USAGE.md` did not exist; created here as required by the spec 05 completion gate.
- `apps/api/` directory does not yet exist — spec 05 touch list correctly identifies `apps/api/package.json` and `apps/api/tsconfig.json` as new files to create.
- Spec 04 filename is `04-redemption-traversal.md` (not `04-redemption-agent.md`); spec 06 is `06-wallet-and-earning-agents.md` (not `06-wallet-earning-agents.md`).

### Deferred / non-blocking items documented in spec §20

- Final `commitMutation` signature from spec 02 (Alan) — non-blocking; adapter seam identified
- Python subprocess protocol — deferred to specs 04/06
- World-graph data in `GraphSnapshot` — extensible interface; deferred to specs 04/06
- LLM-backed Decomposer — future spec; seam is the `Decomposer` interface

### Implementation validation commands (for spec 05 implementation phase)

```bash
# Setup (once)
cd apps/api && npm install --save-dev typescript vitest @types/node

# Red phase (before production code)
cd apps/api && npm test -- tests/orchestrator
# Expected: 11 failures

# Green phase (after implementation)
cd apps/api && npm run typecheck && npm test
# Expected: 11 tests pass, 0 errors
```

### Manual review performed

Spec reviewed against all 13 required question areas from the hardening task prompt. All 13 are addressed. Definition of Ready gate cleared. No blocking items remain.

---

## Entry 002 — Spec 05 Re-review and Correction (2026-06-22)

**Task:** Second review and correction of `context/feature-specs/05-orchestrator-harness.md`. The earlier hardening pass (Entry 001) was reviewed and **found to contain blocking architectural contradictions**; this entry documents the corrections.
**Branch:** `Alan-branch-schema` (actual working branch; Entry 001's `raq/orchestrator-harness` was not the branch in use).
**Files modified:** `context/feature-specs/05-orchestrator-harness.md`, `AI_USAGE.md` (this entry appended).
**Production code changed:** No. **Tests run / runtime validation performed:** None — this was documentation-only. No package, lockfile, schema, or generated-contract file was changed.

### Tools used

- Claude Code (Opus 4.8) — full spec re-audit and rewrite.
- `Read` / `Bash` — read all required repository sources and inspected the actual physical layout (no `apps/`, `src/`, or root `package.json` tracked; only generated `schema/generated/types.ts`).

### Why the prior pass was not implementation-ready

Entry 001 declared the spec `Ready`, but it carried contradictions that would force an implementing agent to invent architecture or weaken the central invariant. The blocking issues and their corrections:

1. **Stringly-typed mutation envelope** (`mutationType: string`, `targetTable: string`, `payload: Record<string,unknown>`) → replaced with a TEMPORARY discriminated union (`MutationKind` / `SpecialistMutation`, literal discriminants, typed payloads) derived from the canonical request shapes in `schema/mutations.py` and the literal vocabulary in `schema/generated/types.ts`. No `targetTable: string`, no `payload: unknown`. Exact replacement seam = Phase A3 codegen → `packages/schema-ts/` (ADR 0007). (§10.1)
2. **Agents got only `{ agentType }`** → added a typed `AgentOperation` discriminated union; `AgentInvocation` ties each `agentType` to exactly its operation variant. Three layers now distinguished: user NL (`queryText`, Decomposer-only), typed decomposed intent (`AgentOperation`), prohibited free-text coordination (none). (§6.2)
3. **No enforced ownership** → added `MUTATION_OWNERSHIP` (production map, schema-final §6.2) + `isOwnedBy`; enforced at runtime in the commit adapter (rejects unowned `kind` before any state change → `OwnershipError`) and at compile time (agent-facing commit accepts only `SpecialistMutation`, excluding orchestrator variants). (§6.4)
4. **Commit could fail while the run "succeeded"** → the agent-facing `commit` now REJECTS with typed `CommitFailure`; the harness treats it identically to a thrown agent error (run failed, Plan failed, no checkpoint update, halt). Failure kinds enumerated for validation/ownership/OCC/idempotency-conflict/unexpected. (§10.3)
5. **Idempotency treated as undecided** → it is decided by `schema-final §5.3` + invariant 13: same key + same fingerprint → replay success; same key + different fingerprint → conflict (409 analogue). Stub models call-level fingerprint dedup; durable `idempotency_records` deferred to spec 02. (§10.4)
6. **Overstated TS guarantees** ("structurally impossible") → replaced with an accurate type-vs-runtime table; documented that process-level and Python import/credential isolation are NOT provided here (subprocess boundary, ADR 0007, invariant 11). (§5)
7. **Duplicate type locations** (`src/types/agents.ts` + `src/agents/types.ts`; `FakeDecomposer` in prod and test) → one canonical production file per area (`apps/api/src/agents/contracts.ts`, `apps/api/src/orchestrator/contracts.ts`); all doubles/fakes under `apps/api/tests/`. (§13–§14)
8. **Inconsistent commit factory forms** → one exact `AgentCommitFactory.create(binding): AgentCommit`, binding `userId/planId/agentRunId/agentType/onCommitSucceeded`. (§10.2)
9. **Plan lineage vs. revision conflict** → new-plans-only (`PlanRequest { userId, queryText }`), fresh `plan_lineage_id`, `revision_number = 1`; one-current invariant enforced at the `current` transition (mirrors `plans_one_current_revision`), not at `generating` creation. (§7)
10. **Manual-verify contradiction** → removed the `scripts/manual-verify.ts` script and the `tsx` dependency and the grep checks; manual verification now runs the named end-to-end test (T12) with verbose output, using only touch-list files. (§18)
11. **Unrealistic red phase** ("11 tests must each fail") → realistic TDD: tests authored first; targeted run is red because modules/imports are missing (suite-load failure counts as red); actual red result recorded in `AI_USAGE.md`. (§17)
12. **Stub did no validation** → the in-memory commit double now rejects unknown discriminants, unowned mutations, invalid identifiers, invalid read-set versions, and empty idempotency keys; OCC/txn (spec 02) and domain rules (specialist specs) kept separate. (§12)
13. **`PlanRepository` vs. graph-write invariant** → reconciled: orchestrator Plan/AgentRun lifecycle writes ARE typed graph-write commands (one seam, two actor-scoped ports). The canonical Python `V31GraphWriteService.create_plan` already writes `graph_mutations`, confirming option (a). Renamed the port `OrchestratorGraphWrite`; agents cannot reach it (absent from `AgentContext`). (§9)
14. **Exact-output claims** ("Test Files 2 passed / Tests 11 passed") → replaced with semantic outcomes (targeted + full suite pass, no skips, typecheck clean, commands logged). (§17)

### Repository sources that determined the revised contracts

- `docs/adr/0004-runtime-topology.md` + `context/architecture-context.md` §System boundaries — confirmed `apps/api` (Hono+TS) is the **mandated** orchestrator location (not invented); specs' bare `src/...` paths normalize to `apps/api/src/...`.
- `schema/mutations.py` (`V31GraphWriteService`, `CreatePlanRequest`/`CreatePlanStepRequest`/`RecordStateDependencyRequest`/`TransferPointsRequest`) — canonical mutation request shapes; `create_plan` writes `graph_mutations` (resolved blocker 13).
- `schema/generated/types.ts` — canonical literal unions (`NodeType`, `MutationAction`); replacement seam for the temporary union.
- `docs/architecture/schema-final.md` §4.1–4.2 (Plan lifecycle, `plans_one_current_revision`), §4.6 (`agent_runs`), §5.3 (idempotency), §6.2 (mutation ownership).
- `docs/adr/0001-schema-lock.md`, `0005-plan-lineage-replan-jobs.md`, `0007-contract-ownership-codegen.md`, `0008-per-user-serialization-sse.md`.
- `context/feature-specs/02-graph-write-path.md` — `commitMutation(userId, mutation, readSet, idempotencyKey)`; still `Draft` (deferred dependency).
- `context/feature-specs/04-redemption-traversal.md`, `06-wallet-and-earning-agents.md` — specialist ownership and the typed operations agents need.
- `context/architecture-context.md` §Invariants (1, 2, 3, 6, 7, 11, 13); `AGENTS.md` (bookkeeping / STATUS.md / tracking ownership).

### Temporary (clearly marked, exact seam)

- The `SpecialistMutation` / `MutationKind` union (§10.1) — temporary until Phase A3 codegen; mapped 1:1 to future generated variants; replaced behind the `AgentCommit`/`AgentCommitFactory` seam with zero test/public-behavior change.
- The in-memory `InMemoryAgentCommitFactory` and `InMemoryOrchestratorGraphWrite` doubles — stand-ins for the eventual `V31GraphWriteService`-backed adapters; they implement production interfaces.

### Deferred (not invented)

- Spec 02 real write path: OCC retry, advisory lock, `graph_mutations` / `idempotency_records` / `replan_jobs` persistence, staleness propagation.
- Python subprocess protocol and credential/import isolation (ADR 0007, specs 04/06).
- Re-plan worker, lineage revisioning, world-graph snapshot fields, LLM-backed decomposer.

### Final readiness verdict

`Ready with non-blocking deferred dependency` — all seven "Not ready" gates cleared (canonical typed-mutation representation, typed operation, ownership, commit-failure lifecycle, write-boundary model, exact adapter contract, repository-correct structure/commands). The only deferred items are reached solely through the `AgentCommitFactory` interface and one temporary union file, and cannot change this unit's tests or public behavior.

---

## Entry 003 — Spec 05 Third-Pass Targeted Correction (2026-06-22)

**Task:** Final targeted correction of `context/feature-specs/05-orchestrator-harness.md`. A further review of the Entry 002 output found that several contracts were still not closed/typed enough to be implementation-ready; this entry documents those corrections.
**Branch:** `Alan-branch-schema`.
**Files modified:** `context/feature-specs/05-orchestrator-harness.md`, `AI_USAGE.md` (this entry appended; Entries 001–002 unchanged).
**Production code changed:** No. **Tests run / runtime validation performed:** None — documentation-only. No package, lockfile, schema, or generated-contract file was changed.

### Tools used

- Claude Code (Opus 4.8) — targeted re-audit and rewrite.
- `Read` / `Bash` — re-read `schema/generated/types.ts` (NodeType/MutationAction vocabulary), `docs/architecture/schema-final.md` §4.3 (`plan_steps`) / §4.4 (`state_dependencies`, MVP staleness scope B2), and `context/feature-specs/02-graph-write-path.md` (single-transaction commit) to ground every new typed field.

### Why the prior Ready verdict was revised (status moved to `Needs Revision` during the pass, restored to Ready on completion)

Entry 002 closed the major contradictions but left contracts that an implementer could still widen or guess. The remaining blockers and their corrections:

1. **Generic mutation escape hatches remained** (`payload: Record<string, unknown>`, `targetTable: string`, `snapshotValue: Record<string, unknown>`). → `CreatePlanStepMutation` is now discriminated by `stepType` with one closed payload interface per schema-final §4.3 step type (`CardAssignmentPayload`/`SpendAnalysisPayload`/`RedemptionRecommendationPayload`/`TransferRecommendationPayload`), each holding only id references to real `NodeType`s. `RecordStateDependencyMutation.target` is a closed `StateDependencyTarget` union over the MVP staleness scope (`user_balances`/`UserBalance`, `user_program_statuses`/`UserProgramStatus`, schema-final §4.4 B2) with typed `snapshotValue`. No generic record, no open `targetTable`. JSONB columns are represented at the narrowest spec-05 width; richer domain fields explicitly deferred to specs 04/06. (§10.1, §12)
2. **Fake agents ignored their operation.** → Each fake agent now derives its committed mutation from the operation: wallet selects the `user_balances` row by `operation.programIds[0]`; earning's payload `spendCategoryId` comes from the operation; redemption's payload comes from `targetRedemptionOptionId` + `sourceProgramIds[0]`. New tests T13 (operation-derived) and T14 (operation change → different mutation). (§11, §16)
3. **`AgentContext.operation` was too broad.** → Introduced `OperationByAgent` and parameterized `Agent<K>` / `AgentContext<K extends SpecialistAgentType>`; `AgentRegistry = { readonly [K in SpecialistAgentType]: Agent<K> }`. Orchestrator dispatches via a type-correlated `switch` on `agentType` (documented TS correlated-union limitation). Compile-time coupling tested by T31. (§6.2, §6.3)
4. **No runtime validation of decomposer output.** → Added `validateDecomposedQuery` (manual type guard, no new dependency) + `OrchestrationError('DecompositionInvalid')`. Validates the whole `DecomposedQuery` before any `AgentRun`: unknown agentType, unknown operation kind, agentType/operation mismatch, wrong kind for agent, missing identifiers, invalid enums, unexpected keys, empty sequence. On failure: no `AgentRun`, no agent, generating Plan → `failed`, throw. Tests T22–T28. (§6.5, §3)
5. **Manual verification overclaimed reporter output.** → §18 is now an explicit code-and-result review: run T12 verbose to confirm it passed, then read the committed T12 assertion block to confirm coverage, then record the review in `AI_USAGE.md`. No claim that the reporter prints internal values. (§18)
6. **Checkpoint-persistence failure was undefined.** → Chose the **atomic** design (matches spec 02 "single transaction"): a successful commit records the specialist mutation and merges `last_read_versions` as one all-or-nothing block via `onCommitSucceeded`. If the checkpoint merge fails, the mutation is rolled back and `commit` rejects `UnexpectedCommitError` — no partial state, so no recovery procedure is needed. In-memory `failCheckpointOnce` seam + test T21. (§9, §10.6)
7. **Orchestrator mutation modeling was inconsistent** (`MutationKind` named orchestrator commands with no corresponding interfaces). → Chose **Option B (typed method-command port)**: removed orchestrator names from the mutation vocabulary; renamed `MutationKind` → `SpecialistMutationKind`; `MUTATION_OWNERSHIP` is keyed by `SpecialistAgentType` only; the `OrchestratorGraphWrite` method signatures _are_ the closed orchestrator command contract. Specialist-vs-orchestrator ownership kept separate. (§6.4, §9)
8. **Remaining interfaces made exact:** `GraphSnapshotBuilder`, `AgentRegistry`, `OrchestratorDeps` (constructor), `OrchestrationError`, `validateDecomposedQuery`, and the "registry is exhaustive → no missing-agent branch" behavior. (§6.3, §6.5, §8)
9. **Tests + touch list updated:** 32 named tests across 4 files (added `decomposition.test.ts`; added operation-coupling, atomicity, and decomposition tests). Added production files `orchestrator/decomposition.ts`; added `RawDecomposer` / `SpecialistNamingPlanCommand` doubles and the `failCheckpointOnce` seam. No schema files or manual scripts added. (§14, §16)

### Repository sources that grounded the new typed fields

- `schema/generated/types.ts` — `NODE_TYPES` (CreditCard, RewardProgram, SpendCategory, RedemptionOption, UserBalance, UserProgramStatus, …) confirm every id field references a real node type; `MUTATION_ACTIONS` vocabulary.
- `docs/architecture/schema-final.md` §4.3 (`plan_steps.step_type` CHECK + `payload` jsonb), §4.4 (`state_dependencies` columns + **MVP staleness scope B2 = `user_balances`, `user_program_statuses`** — the authority that closes the `targetTable` union).
- `context/feature-specs/02-graph-write-path.md` — commit applies mutation + audit + staleness "in a single transaction" → grounds the atomic checkpoint decision (§10.6).

### No human decision still required

All eight blockers resolved with exact contracts and tests. Both modeling forks (checkpoint atomicity, orchestrator-command modeling) were decided in-spec against repository authority, not left to implementation.

### Deferred dependencies (unchanged, non-blocking)

- Phase A3 generated mutation types (`packages/schema-ts/`, ADR 0007) — replacement seam for the temporary union.
- Spec 02 real write path (OCC/retry, advisory lock, audit/idempotency rows, single-txn atomicity, staleness).
- Python subprocess protocol/credential isolation; LLM-backed `Decomposer`; re-plan worker; richer plan-step/state-dependency payloads and world-graph snapshot fields.

### Final readiness verdict

`Ready with non-blocking deferred dependency` — all blockers resolved with closed, exhaustively-typed contracts and named tests; deferred items are reached only through the `AgentCommitFactory` / `OrchestratorGraphWrite` interfaces and one temporary union file and cannot change this unit's tests or public behavior.

---

## Entry 004 — Spec 05 Final Four Surgical Corrections (2026-06-22)

**Task:** Four targeted pre-implementation corrections to `context/feature-specs/05-orchestrator-harness.md`
**Branch:** `Alan-branch-schema`
**Files modified:** `context/feature-specs/05-orchestrator-harness.md`, `AI_USAGE.md` (this entry appended)
**Production code changed:** No
**Prior entries:** 001–003 preserved verbatim

### Corrections made

1. **Implementation order (§13) — tests before production modules.** The prior step order authored tests at step 5, after contracts (steps 2–4). Corrected to: (1) scaffold, (2) write all tests and doubles, (3) run and record the red phase, then (4–6) write production contracts/ownership/orchestrator, (7) run green gates. The red-phase record requirement is now a gate that must be completed before any production code is written.

2. **`Decomposer.decompose` return type (§6.2, §3) — trust boundary honesty.** The interface previously declared `Promise<DecomposedQuery>` as the return type, treating the LLM-backed output as already-validated. Changed to `Promise<unknown>`. The caller (`Orchestrator`) immediately passes the raw value to `validateDecomposedQuery(raw)` before narrowing to `DecomposedQuery`. `FakeDecomposer` and `RawDecomposer` descriptions updated accordingly. The `queryText` behavior invariant (§3, line 71) clarified: "interpreted only by the Decomposer and never passed to a specialist agent" (more accurate than "read only", since `queryText` is also stored in `createPlan` for audit but not interpreted there).

3. **`tsconfig.json` module resolution (§13, §14, §17) — `Bundler` instead of `NodeNext`.** `NodeNext` requires `.js` extensions on relative TypeScript imports at runtime. Since `apps/api` in this spec is consumed only by Vitest (not a Node ESM runtime), `"module": "ESNext"` + `"moduleResolution": "Bundler"` is the correct choice: it aligns with Vitest's resolution strategy and eliminates the class of `.js`-extension errors an implementer would discover mid-task.

4. **Atomic checkpoint ownership (§3c, §3e, §9, §10.2, §10.6) — remove `onCommitSucceeded` callback.** The prior `AgentCommitBinding` included `onCommitSucceeded: (readSet: ReadSet) => Promise<void>` as an orchestrator-supplied hook. An arbitrary callback cannot share the graph-write service's database connection or transaction scope, so "invoke callback inside the atomic block" was unenforceable at the interface level. Removed the callback field from `AgentCommitBinding`; the `AgentCommitFactory` now owns the `agent_runs.state.last_read_versions` write directly using the bound `agentRunId`. The production adapter writes the checkpoint inside the same database transaction as the specialist mutation; the in-memory adapter uses a rollback-capable all-or-nothing block. Atomicity is now a property of the factory's implementation, not of an orchestrator-supplied callback.

### Sources grounding these decisions

- `Decomposer → unknown`: trust boundary principle; `validateDecomposedQuery` already accepted `unknown` (§6.5 was already correct); change aligns the interface with the function signature.
- `Bundler` resolution: Vitest documentation and the self-contained, Vitest-only nature of `apps/api` in this unit.
- Callback removal: spec 02 "single transaction" mandate; the real graph-write service owns the connection; a callback parameter cannot share that connection; using `agentRunId` makes the factory implementation self-sufficient.

### No human decision still required

All four corrections are resolvable from repository architecture and authoritative spec constraints. No new forks introduced.

### Files not modified

No production code, test files, schema files, package files, lockfiles, other specs, or tracking files changed.

### Final readiness verdict

`Ready with non-blocking deferred dependency` — maintained. The four corrections remove implementation-time landmines; no architectural decision changed.

---

_This file will be updated by implementation agents executing each feature spec's completion gate._

---

## Entry 005 — Spec 05 Implementation (2026-06-22)

**Task:** Implement orchestrator loop and agent harness per `context/feature-specs/05-orchestrator-harness.md`
**Branch:** `Alan-branch-schema`
**Status:** In progress (red phase recorded; production implementation underway)

### Red-phase result (recorded before production code)

**Command:**

```bash
cd apps/api && npm test -- tests/orchestrator tests/agents
```

**Actual outcome (exit code 1):**

- Test Files: 3 failed | 1 passed (4)
- Tests: 4 passed (4) — only `agent-harness.test.ts` loaded (type-only imports from missing `src/` modules)
- Failed suites: `commit-ownership.test.ts`, `decomposition.test.ts`, `orchestrator.test.ts`
- Failure mode: `Cannot find module '../../src/agents/contracts'` / `'../../src/orchestrator/contracts'` / `'../../src/orchestrator/orchestrator'` — unresolved imports as expected before production modules exist

**Dependency install:** `npm install --no-package-lock` (no `package-lock.json` created — file not in §14 touch list)

### Tools used

- Cursor Agent (ce-work workflow)
- Vitest 3.2.6, TypeScript 5.8.3
- `npm run typecheck`, `npm test`

### Important implementation decisions

1. **Temporary `SpecialistMutation` union** in `apps/api/src/agents/contracts.ts` — closed discriminated union mirroring `schema/mutations.py` + schema-final §4.3–4.4; replacement seam is `AgentCommitFactory` / generated `packages/schema-ts/` import (ADR 0007).
2. **Orchestrator commands vs specialist mutations** — `OrchestratorGraphWrite` typed methods for Plan/AgentRun lifecycle; specialists commit only `SpecialistMutation` variants through `AgentCommit`.
3. **`Agent<K>` / `AgentContext<K>` coupling** — type-correlated `switch` dispatch in orchestrator preserves operation narrowing per agent type.
4. **`validateDecomposedQuery`** — manual type guard on `unknown` decomposer output; rejects empty/mismatched/malformed/extra-key invocations before any `AgentRun`.
5. **Atomic checkpoint** — `InMemoryAgentCommitFactory` records mutation + merges `last_read_versions` in one block; `failCheckpointOnce` seam rolls back mutation on checkpoint failure (T21).
6. **`tsconfig` `moduleResolution: "Bundler"`** per spec §17 — avoids `.js` extension requirement for Vitest-only package.
7. **No `package-lock.json`** — installed with `--no-package-lock` because lockfile is not in §14 touch list.

### Validation commands and results

```bash
cd apps/api && npm run typecheck && npm test
# exit 0 — 32 tests passed, 0 type errors

cd apps/api && npm test -- tests/orchestrator/orchestrator.test.ts --reporter=verbose
# T12 "completes the persona flow end to end on in-memory doubles" — passed
```

### Manual verification (§18)

1. Ran verbose orchestrator suite — T12 reported **passed**.
2. Read T12 assertion block in `apps/api/tests/orchestrator/orchestrator.test.ts` — confirms Plan `generating → current`, invocation order `wallet_agent → earning_agent → redemption_agent`, three completed `AgentRun` rows with expected `last_read_versions`, exactly 3 recorded commits with operation-derived mutation payloads per §11 fixture.

### Mistakes / surprises

- T29 `@ts-expect-error` for excess `prompt` key only triggers when `operation` is an **inline** object literal; a separate `walletOp` variable disables TypeScript excess-property checking on the outer literal.
- `agent-harness.test.ts` imports `AgentInvocation` from `orchestrator/contracts`, not `agents/contracts` (canonical location per spec §14).

### Deferred / blocked work

- Spec 02 real `V31GraphWriteService` adapters behind `OrchestratorGraphWrite` / `AgentCommitFactory`
- Phase A3 generated mutation types (`packages/schema-ts/`)
- LLM-backed `Decomposer`, Python subprocess launcher (specs 04/06)
- `package-lock.json` not created — add to touch list in a future infra spec if lockfile pinning is desired

### Files touched (§14 only)

**Production:** `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/agents/contracts.ts`, `apps/api/src/agents/ownership.ts`, `apps/api/src/orchestrator/contracts.ts`, `apps/api/src/orchestrator/decomposition.ts`, `apps/api/src/orchestrator/orchestrator.ts`

**Tests:** `apps/api/tests/helpers/*`, `apps/api/tests/orchestrator/*`, `apps/api/tests/agents/agent-harness.test.ts`

**Bookkeeping:** `context/feature-specs/05-orchestrator-harness.md`, `context/progress-tracker.md`, `AI_USAGE.md`

**Status:** Done — all T1–T32 passing, typecheck clean, manual verification complete.

---

## Entry 006 — Spec 05 Lifecycle Error-Handling Hardening (2026-06-22)

**Task:** Address P1 code-review findings — orchestrator lifecycle boundaries, root decomposition validation, targeted tests
**Branch:** `Alan-branch-schema`
**Trigger:** Post-review hardening per user directive (Cursor P1 #1–#3 + root envelope validation)

### Changes

1. **`orchestrator.ts`** — Full per-invocation lifecycle boundary: `createAgentRun`, snapshot build, commit factory, dispatch, and finalize are inside structured error handling. `failInvocation` best-effort finalizes AgentRun + Plan, preserves primary error messages, distinguishes `agent` / `infrastructure` / `lifecycle_persistence` failures. Decomposition catch best-effort `transitionPlanStatus(failed)` with original `OrchestrationError` preserved; cleanup failures attached via `detail.cleanupErrors`.
2. **`decomposition.ts`** — Root `DecomposedQuery` envelope rejects unexpected keys (`invocations` only).
3. **Test doubles** — `InMemoryOrchestratorGraphWrite` fail-seams + command counters; `StubGraphSnapshotBuilder.setThrowOnBuild`; `ThrowingCommitFactory`; `setFailCheckpointOnNthRecord` for second-commit atomicity test.
4. **`in-memory-commit.ts`** — `CreatePlanStep.planId` must match bound plan; no `mergeReadCheckpoint` on `OrchestratorGraphWrite` (checkpoint stays inside commit factory atomic block).

### Tests added/updated (8 new — 32 → 40)

- **orchestrator.test.ts (+6):** createAgentRun throws, snapshot throws, commitFactory throws, finalize(completed) throws, finalize(failed) throws during agent cleanup, decomposition cleanup preserves `DecompositionInvalid` + records cleanup errors
- **decomposition.test.ts (+1):** root unexpected key on decomposed query
- **commit-ownership.test.ts (+1):** `failCheckpointOnNthRecord(2)` rolls back only second commit

### Validation

```bash
cd apps/api && npm run typecheck && npm test
# 40 passed (32 baseline + 8 new), 0 type errors
```

### Explicitly not done (per user)

- No `mergeReadCheckpoint` on `OrchestratorGraphWrite` public port
- No new `shared/contracts.ts` for circular type imports (deferred)

### Verbose T12 output (§18 manual verification — terminal transcript)

```
 RUN  v3.2.6 /…/gpFree/apps/api

 ✓ tests/orchestrator/orchestrator.test.ts > orchestrator > decomposes a persona query into ordered typed operations 6ms
 ✓ tests/orchestrator/orchestrator.test.ts > orchestrator > passes each agent the typed operation matching its own agent type 2ms
 ✓ tests/orchestrator/orchestrator.test.ts > orchestrator > creates one Plan generating then current with one ordered AgentRun per invocation 1ms
 ✓ tests/orchestrator/orchestrator.test.ts > orchestrator > records last_read_versions from readSet on first successful commit 1ms
 ✓ tests/orchestrator/orchestrator.test.ts > orchestrator > merges last_read_versions across multiple commits in one run 1ms
 ✓ tests/orchestrator/orchestrator.test.ts > orchestrator > persists neither mutation nor checkpoint when a commit fails 1ms
 ✓ tests/orchestrator/orchestrator.test.ts > orchestrator > marks the AgentRun failed when a commit fails 1ms
 ✓ tests/orchestrator/orchestrator.test.ts > orchestrator > marks the Plan failed when a required commit fails 0ms
 ✓ tests/orchestrator/orchestrator.test.ts > orchestrator > does not invoke later agents after a failed commit 1ms
 ✓ tests/orchestrator/orchestrator.test.ts > orchestrator > treats a thrown agent error like a failed commit 1ms
 ✓ tests/orchestrator/orchestrator.test.ts > orchestrator > is the only component that creates or transitions Plans 0ms
 ✓ tests/orchestrator/orchestrator.test.ts > orchestrator > completes the persona flow end to end on in-memory doubles 1ms
 ✓ tests/orchestrator/orchestrator.test.ts > orchestrator > derives each agent's committed mutation from its typed operation 0ms
 ✓ tests/orchestrator/orchestrator.test.ts > orchestrator > produces a different mutation when the operation changes 0ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  20:46:53
   Duration  1.31s (transform 142ms, setup 0ms, collect 205ms, tests 18ms, environment 0ms, prepare 102ms)
```

---

## Entry 007 — Spec 05 Post-Audit Fixes (2026-06-22)

**Task:** Two medium-severity findings from the final verification audit (ce-code-review) required correction before merge.
**Branch:** `Alan-branch-schema`
**Files modified:** `apps/api/tests/helpers/in-memory-commit.ts`, `apps/api/tests/orchestrator/orchestrator.test.ts`, `apps/api/tests/orchestrator/commit-ownership.test.ts`, `AI_USAGE.md`
**Production code changed:** No (all changes are in test helpers and test files)

### Tools used

- Claude Code (Sonnet 4.6) — ce-work and ce-code-review skills
- Vitest 3.2.6, TypeScript 5.8.3

### Findings addressed

**Finding 1 (Medium) — Fingerprint defect in `in-memory-commit.ts:25`**

The `stableFingerprint` function used `JSON.stringify(mutation, Object.keys(mutation).sort())`. When `JSON.stringify`'s second argument is an array, it acts as a recursive key whitelist at every nesting level — nested objects whose keys are not in the top-level array serialize as `{}`. Two `CreatePlanStep` mutations differing only in `payload.spendCategoryId` produced the same fingerprint and would incorrectly replay instead of producing `IdempotencyConflict`.

Fix: replaced the array replacer with a function replacer that recursively sorts object keys:

```ts
(_, val: unknown) =>
  val !== null && typeof val === "object" && !Array.isArray(val)
    ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort())
    : val;
```

**Finding 2 (Medium) — Tautological T2 assertion in `orchestrator.test.ts:65`**

The intercepting agents pushed `{ agentType: ctx.operation.agentType, operationAgentType: ctx.operation.agentType }` — both fields derived from the same source. The assertion `entry.agentType === entry.operationAgentType` was trivially true regardless of routing correctness.

Fix: changed the capture to `{ registeredType: "<literal>", operationAgentType: ctx.operation.agentType }` where `<literal>` is the string constant matching the outer registry key (`"wallet_agent"`, `"earning_agent"`, `"redemption_agent"`). The assertion now compares the orchestrator's dispatch intent against the operation that actually arrived.

### New nested-payload idempotency tests added to `commit-ownership.test.ts`

Three tests added to exercise the corrected fingerprinter on nested mutations (previously the only idempotency tests used `UpdateUserBalance` which has only flat fields):

- `replays a CreatePlanStep with the same nested payload and idempotency key` — confirms `spend_analysis` payload replay is deterministic
- `rejects the same key when the CreatePlanStep nested payload differs` — confirms a changed `spendCategoryId` produces `IdempotencyConflict`
- `rejects the same key when the RecordStateDependency nested snapshotValue differs` — confirms a changed `snapshotValue.balancePoints` in the `target` discriminant produces `IdempotencyConflict` (uses `redemption_agent`, which owns `RecordStateDependency`)

### Validation commands and results

```bash
cd apps/api && npm test
# exit 0 — 43 tests passed (40 after Entry 006 + 3 nested-payload idempotency), 4 test files, 0 skipped

cd apps/api && npm run typecheck
# exit 0 — 0 errors
```

### Deferred / unchanged

No production contracts changed. All deferred items from Entry 005 remain unchanged. The fingerprint fix is in the in-memory double only; the production adapter (spec 02) will implement fingerprinting inside the database transaction using a server-side stable serialization strategy.

---

## Entry 008 — Spec 07 API Service Implementation (2026-06-24)

**Task:** Implement the demo-shell HTTP service per `context/feature-specs/07-api-service.md` (RCG-18)
**Branch:** `raq/demo-mocks`
**Commit:** `feat(api): implement spec 07 sync HTTP surface + hero bridge (RCG-18)`
**Files created:** `apps/api/src/plans/{types,service,routes,bridge-service}.ts`, `apps/api/src/http/auth.ts`, `apps/api/src/server.ts`, `apps/api/bridge/hero_bridge.py`
**Files updated:** `apps/api/package.json`, `apps/api/package-lock.json`, `.env.example`, `context/feature-specs/07-api-service.md`, `fixtures/mock-plan.json`, `fixtures/mock-mutation-events.json`
**Production code changed:** Yes

### Tools used

- Cursor Agent — spec 07 implementation (`2d7afa6`): routes, bridge, server, mocks, spec amendments
- Claude Code (Sonnet 4.6) — ce-work verification pass: re-ran 75 TS + 22 Python unit tests, typecheck; documented decisions and remaining gates

### Test evidence

`src/plans/routes.test.ts` exercises all six plan routes via an in-memory `PlanService` fake (no DB/Python). Suite is part of commit `2d7afa6` and gates HTTP validation + error-code mapping.

### Implementation decisions

1. **Option B (psql-subprocess bridge)**: `psycopg` not installed; reused the exact `_PsqlConnection` / `_PsqlCursor` adapter from `tests/integration/test_hero_moment.py`. Bridge lives at `apps/api/bridge/hero_bridge.py`; spawned once per request by `BridgePlanService`.
2. **`PlanService` port** (`src/plans/service.ts`): routes depend only on this interface → unit-tested with an in-memory fake, no DB or Python required.
3. **Synchronous `200` for `POST /plans` and `POST /balance-transfer`**: resolved Open Question #2 from the spec; the bridge builds and commits the plan in-request.
4. **Single projection source**: Python bridge owns both reads and writes and returns the `PlanView` shape. TypeScript only marshals args, parses the `{ok, data|error}` envelope, and maps `error.code` → `PlanServiceError` → HTTP status.
5. **`AUTH_DEV_USER_ID` local bypass**: `server.ts` short-circuits Clerk verification when this env var is set, so the API is curl-testable without a real Clerk token.
6. **Bridge import path**: `hero_bridge.py` prepends `REPO_ROOT` to `sys.path`; `BridgePlanService` also sets spawn `cwd` + `PYTHONPATH` so `schema.*` and `tests.integration.*` resolve reliably.
7. **Route ordering**: `GET /plans/current` registered before `GET /plans/:planId` to avoid Hono matching `current` as a param.

### Validation commands and results

```bash
npm --prefix apps/api test
# 75 tests, 8 test files — all passed

npm --prefix apps/api run typecheck
# exit 0 — 0 errors

python3 -m unittest tests.test_v31_mutations -v
# 22 tests passed, 1 skipped (live Postgres — expected without RUN_LIVE_POSTGRES_TESTS=1)
```

### Remaining manual gates (blocks "Done" status)

1. **Live Clerk token smoke-test** — `CLERK_SECRET_KEY` not exercised in CI/sandbox:

```bash
npm --prefix apps/api run dev
curl -s localhost:8787/session -H "Authorization: Bearer $TOKEN"
curl -s -XPOST localhost:8787/plans -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"query":"Best way to Tokyo in October?"}'
```

2. **`GET /session` persona bootstrap clone** — implemented: new Clerk users (`clerkId` only) trigger idempotent persona clone from `fixtures/demo-seed.json` (balances, statuses, goals, holds). Verified live against docker Postgres + bridge smoke. Clerk JWT path unit-tested via `clerk-auth.test.ts` (mocked `verifyToken`).

Live Postgres hero smoke (session → create-plan → balance-transfer → demo-reset) passed against docker-compose. **Remaining gate:** manual `npm --prefix apps/api run dev` + real Clerk bearer curl (blocked in agent sandbox for server boot; run locally).

### Files not touched (per spec touch list)

`STATUS.md`, `tracking/`, other feature specs, schema DDL, Python graph-write behavior, existing mutation route behavior, `apps/web/**`.

### Deferred

- Graduate `tests/integration/hero_flow.py` to a non-test package (`agents/hero/`) post-demo — bridge import path is the only line to change.
- Live `tsx` server boot auto-verification — `tsx`'s IPC pipe is sandbox-incompatible; verify manually with `npm --prefix apps/api run dev`.

## Entry 009 — RCG-60 Railway Deployment: API container + local verification (2026-06-25)

### Tools and models used

- Claude Code (Opus 4.8, 1M context) — `ce-work` execution skill.
- Local: `docker` (Desktop), `npm`, `python3`, `psql`, `railway` CLI.

### Platform decision

Railway, per the RCG-60 brief and ADR 0004 (which lists Railway as an allowed
managed-Postgres option). Scope this pass: **API container + managed Postgres**.
Web deploy deferred — the frontend does not consume the API yet.

### Dockerfile decisions (root `Dockerfile`)

- Base `node:22-bookworm-slim`; apt-installs `python3`, `postgresql-client`,
  `ca-certificates`. **No `pip install`** — the hero bridge imports only stdlib +
  in-repo `schema.*`/`tests.integration.*` and shells out to `psql`.
- **Install only `apps/api` deps** (`npm --prefix apps/api ci`). Deviation from the
  brief's suggested dual `npm ci`: root `package.json` has no `workspaces` and is
  the Next.js web app — root `npm ci` would install React/Next, irrelevant to the
  API, and bloat the image. Verified `apps/api` is a standalone npm project.
- `COPY . .` (full tree) so the Python bridge's `schema/`, `tests/integration/`,
  `fixtures/` imports resolve. `.dockerignore` keeps those in; excludes
  `node_modules`, `.next`, `.env*`, caches, `.git`.
- `start` = `tsx src/server.ts` (no build step; `tsx` is a runtime dep).

### Port decision

Server reads `process.env.API_PORT ?? 8787` (`apps/api/src/server.ts:13`).
Setting `API_PORT=8080` binds 8080 with **no code change** — verified locally. No
`PORT` fallback added (not required). No Commit 2.

### Commands executed (local) and results

| Command                                                                               | Result                                  |
| ------------------------------------------------------------------------------------- | --------------------------------------- |
| `docker build --no-cache -t rcg-api .`                                                | success, image **631 MB**               |
| `docker run rcg-api node --version`                                                   | `v22.23.1`                              |
| `docker run rcg-api python3 --version`                                                | `Python 3.11.2`                         |
| `docker run rcg-api psql --version`                                                   | `psql (PostgreSQL) 15.18`               |
| `python3 -c "import schema.mutations; import tests.integration.hero_flow"` (in image) | `bridge-imports-ok`                     |
| container `GET /health` (vs local Postgres via `host.docker.internal`)                | `200 {"ok":true}`                       |
| `docker stop` (SIGTERM)                                                               | graceful, 0s (npm CMD forwards signal)  |
| `npm --prefix apps/api run typecheck`                                                 | exit 0, no errors                       |
| `npm --prefix apps/api test` (vitest)                                                 | **86 passed** (9 files), exit 0         |
| `python3 -m unittest discover -v`                                                     | **88 passed, 8 skipped** (live), exit 0 |
| `RUN_LIVE_POSTGRES_TESTS=1 PGDATABASE=rewards_test … test_hero_moment`                | **2 passed** (8.07s), exit 0            |

### Mistakes / review findings caught during the pass

- Brief's import probe assumed `tests.integration.hero_flow` — confirmed correct
  against `hero_bridge.py:38` (not a guess).
- Initial container smoke test reported false failures: `curl --retry-connrefused`
  does **not** retry on _connection reset_ (error 56), which Docker Desktop's port
  proxy returns before the app binds. The server was always healthy; fixed the
  probe with `--retry-all-errors`. Documented in `docs/deployment/railway.md`.
- Brief's dual `npm ci` corrected to `apps/api`-only (see Dockerfile decisions).

---

## Option B baseline assembly — 2026-06-27 (PROMPT A)

**Tool:** Claude Sonnet 4.6 via Claude Code CLI  
**Session:** Option B thesis-verification sprint — baseline assembly  
**Branch:** `chore/option-b-shared-baseline`

### What was done

- Classified and discarded incorrect root-level `pg`/`@types/pg` additions from
  `package.json`/`package-lock.json` (wrong layer — `pg` belongs in `apps/api`
  only, already present at `^8.12.0`).
- Committed `PlanProjectionPort` interface to `apps/api/src/orchestrator/contracts.ts`
  (Contract 7 — persisted Plan → PlanView). Encodes the seam in-repo so both
  implementation branches can import it without accessing `_bmad-output/`.
- Assembled `chore/option-b-shared-baseline` from `origin/main @ 3ed4eeb`
  (post-PR #47 + PR #50 merge).
- Copied and normalised three planning artifacts to `docs/plans/option-b/`:
  `adr-0010-orchestrator-canonical-runtime-DRAFT.md`, `orchestrator-thesis-contracts.md`,
  `architecture-option-b.md` (as-built vs target, post-PR #47 collision map,
  branch topology, validation matrix, no-go conditions).
- Verified PR #50 (`fix/backend-seed-data-flow`) MERGED 2026-06-27T20:17:11Z — all
  gates green; `scripts/ensure_schema_seed.py` and schema assertions live on main.
- Reviewed PR #47 (`val/graph-fe`); posted CHANGES_REQUESTED with one pre-merge
  requirement (regression test for `_cash_fallback_plan` wording); Val addressed it
  and PR merged.
- Recalculated post-PR #47 collision map: zero single-file collisions remain.
  `server.ts` touched by PR #47 (formatting-only) and Prompt C (PLAN_ENGINE) — no
  conflict.

### Important decisions

- `PlanProjectionPort` delegates to Python `project_plan` via `hero_bridge.py` read
  subcommand. Reusing projection only — NOT invoking legacy plan-generation workflow.
- Wallet + Redemption confirmed as the two thesis specialists via
  `agents/ownership.ts`: `redemption_agent` is the sole owner of
  `RecordStateDependency` (the structural staleness mechanism).
- Demo fixture pinned: user `a001` (clerk_hero_demo), Chase UR 180k, Hyatt 30k,
  transfer 30k Chase → Hyatt, Ginza threshold 45k, rev 2 drops transfer step.
- `.coderabbit.yaml` `auto_pause_after_reviewed_commits: 100` committed separately
  on `chore/coderabbit-disable-autopause` (PR #51) — kept out of Option B baseline.

### Validation commands run

| Command | Result |
|---|---|
| `npm --prefix apps/api run typecheck` | ✓ exit 0 |
| `npm --prefix apps/api test` | ✓ 89 passed |
| `npm test` (web Vitest) | ✓ 154 passed |
| `python3 -m unittest discover -v` | ✓ 168 passed, 10 skipped |
| `npm run typecheck` (web) | ⚠ 2 pre-existing unused @ts-expect-error (local pg env artifact; CI green) |
| `npm run build` (web) | ⚠ fails locally (same pg artifact); CI web-build ✓ |
| Secret scan on docs/plans/option-b/ | ✓ no real secrets |

### Mistakes / findings caught

- `auto_pause_after_reviewed_commits: false` rejected by CodeRabbit schema (requires
  integer). Corrected to `100` as effective no-pause threshold.
- `git stash` applied against wrong branch context during typecheck isolation,
  producing merge conflicts in 12 tracked files. Resolved with targeted
  `git checkout HEAD -- <files>` per-file (not `git checkout -- .`).
- Root `package.json` had `pg@^8.22.0` and `@types/pg@^8.20.0` added in a prior
  session — wrong layer (root = Next.js, no direct Postgres access). Discarded
  before baseline assembly.
- Web typecheck errors (`lib/cards/repository.ts:144`, `lib/user/repository.ts:153`)
  are pre-existing on main, not introduced by baseline. CI web-build green.

### Deferred / blocked

- ADR 0010 ratification (copy to `docs/adr/0010-*.md` + decisions-log row) — requires
  lead sign-off after cutover gates pass.
- `docs/plans/2026-06-25-002-feat-frontend-live-api-wiring-plan.md` — kept out of
  baseline; plan covers completed work (now merged in PR #47).
- Live PostgreSQL integration test (`test_hero_moment`) not re-run in this session
  (requires `RUN_LIVE_POSTGRES_TESTS=1`); last known result: 2 passed (hero gate session).
- PR #51 (`chore/coderabbit-disable-autopause`) pending CI + human approval.

---

### Railway config (documented, not yet executed)

`docs/deployment/railway.md` records: API service from root Dockerfile, target
port 8080, health check `/health`, **min instances = 1 / no scale-to-zero**
(ADR 0004 — SSE + replan + subprocess need a persistent process), restart on
failure, and the full variable table. Schema/seed via `psql`/`load_seed.py`
(`--include-demo-persona`, verified to exist at `scripts/load_seed.py:277`), with
the `PGSSLMODE=require` external variant and the reason `dev-db-setup.sh` must not
be used remotely (host + `*_test` guard).

### Documentation changes

- `Dockerfile`, `.dockerignore` (new).
- `docs/deployment/railway.md` (new, canonical).
- `README.md` — concise deploy link.
- `.env.example` — commented hosted-deployment variables (placeholders only).

### Deferred / blocked (external gate)

`IMPLEMENTED — EXTERNAL DEPLOYMENT GATE REMAINS`. Not yet done, requires
user-owned external resources:

- Railway project provision + Postgres + `railway up` (paid, user's account).
- Hosted `/health`, real Clerk Bearer-token `/session`, hosted Plan/replan,
  hosted SSE, `/demo/reset` — a Clerk session token cannot be generated
  server-side.
- Web deploy + browser run — blocked on the frontend consuming
  `NEXT_PUBLIC_API_BASE_URL` (Val-owned; no consumer exists yet).

### Secrets

No secrets recorded. No `.env` read for values; `.env.example` holds placeholders
only; `DATABASE_URL`/tokens never logged. Local verification used the throwaway
`rewards:rewards@…/rewards_test` compose credentials only.

---

## Entry 011 — Option B Prompt C: integration lane to C1 stop gate (2026-06-27)

**Task:** PROMPT C — mount the Option B TypeScript orchestrator runtime
(integration lane). Phases 1–4 + C1 stop gate (Prompt B adapters not yet ready).
**Branch:** `feat/orchestrator-thesis-integration` (from baseline
`904e5796d2aba3736f3d731f3a9afcca13a57f93`)
**Files added:** `apps/api/src/plans/engine-selector.ts` (M5),
`apps/api/src/plans/orchestrator-service.ts` (M6),
`apps/api/src/plans/orchestrator-composition.ts` (Phase 4 root),
`apps/api/tests/plans/{engine-selector,orchestrator-service,orchestrator-composition,bridge-service}.test.ts`,
`apps/api/tests/helpers/fake-bridge.mjs`,
`docs/plans/option-b/c1-integration-audit.md`.
**Files modified:** `apps/api/src/server.ts` (boot-time engine selection +
`/health` engine field), `.env.example` (required `PLAN_ENGINE`).
**Production code changed:** Yes (engine selection + orchestrator service shell;
orchestrator mode fails fast until Prompt B adapters land — no fabrication).

### Tools used

- Cursor agent (Claude Opus 4.8) via the `ce-work` skill.
- `Read`/`Grep`/`Glob` — traced the live runtime (server.ts, plans/*, orchestrator/*,
  agents/*) and the frozen Option B contracts.
- `git worktree` — isolated typecheck/coverage verification and isolated doc commits
  (the shared checkout was being mutated by a concurrent Prompt B agent).

### Important decisions

- **Default-engine policy (prompt vs frozen contract).** Prompt C Phase 2 reads
  "python-legacy remains the operational default," but ADR 0010 §3 + the contracts
  no-go list mandate fail-fast on unset `PLAN_ENGINE` ("unset not failing fast" is
  thesis-invalidating). Per AGENTS.md (locked docs win), implemented **fail-fast on
  unset/invalid**; `python-legacy` is the recommended explicit value + rollback
  target. `.env.example` + Railway notes updated so existing boots set it explicitly.
- **No fabrication at C1.** Orchestrator mode wires through a composition root that
  throws `AdaptersNotIntegratedError` (listing the exact expected Prompt B handoff)
  rather than instantiating any in-memory double in production.
- **M6 decoupled.** `OrchestratorPlanService` receives an injected orchestrator
  runner + `PlanProjectionPort` + read delegate, so it is unit-testable now while the
  real adapters are pending. `createPlan` never falls back to the bridge (ADR 0010 §8).
- File-layout divergence between the two frozen docs is naming-only (ports identical);
  resolved to the contracts-doc names. Recorded in the C1 audit, not a port redesign.

### Validation commands (run in an isolated worktree at HEAD, clean of concurrent edits)

- `npm --prefix apps/api run typecheck` → exit 0 (clean).
- `npm --prefix apps/api run test:coverage` → 128 passed; All files funcs 98.83%,
  branches 84.48%, lines/stmts 87.9% (all above the API floors 88/76/65). No
  threshold weakened; no omit/exclude widened.

### Manual review

- Confirmed no new TS `INSERT/UPDATE/DELETE` against domain tables; no production
  test-double import (a test asserts the composition source imports no fake/stub/
  fixture); no hidden legacy or fixture fallback in orchestrator mode.

### Mistakes / findings caught

- **Concurrent-agent collision (shared checkout).** A Prompt B agent checked out
  `feat/orchestrator-production-adapters` in the same working copy immediately after
  my branch was created, so my 7 commits landed on Prompt B's branch ref. Recovered
  non-destructively: `git branch -f feat/orchestrator-thesis-integration <my HEAD>`
  to secure my commits, then `git reset --mixed <baseline>` on the Prompt B branch
  (working tree preserved) and removed my stray files so Prompt B's lane was left at
  baseline + its own uncommitted adapter work. No shared/pushed history rewritten.
- `tsc --noEmit` on the shared (dirty) tree reported one error from Prompt B's
  in-flight `in-memory-commit.ts` (`ReadSet` type import) — type-only, not mine,
  not staged; isolated worktree typecheck is clean.

### Deferred / blocked

- **C1 STOP GATE.** Phases 5–10 (adapter integration, live initial-plan + replan
  proof, browser evidence, cutover) await Prompt B's `PROMPT B READY FOR C2
  INTEGRATION` handoff. No live PostgreSQL or browser run performed.
- ADR 0010 ratification, Linear updates, `tracking/`/`STATUS.md` — not in this
  code-only branch.

### Secrets

No secrets recorded or logged. Boot evidence logs only the engine name +
no-fallback flag. The bridge env allowlist (CLERK_SECRET_KEY withheld) is unchanged.

---

## Entry 010 — PROMPT B: Option B Production Adapters (2026-06-27)

**Task:** Implement the minimum production adapters to run the TypeScript orchestrator against real PostgreSQL state and the existing Python graph-write boundary. No HTTP routes mounted. No `PLAN_ENGINE` flag. No frontend changes.
**Branch:** `feat/orchestrator-production-adapters` from SHA `904e579` on `chore/option-b-shared-baseline`
**Files modified:** See production adapter table below.
**Production code changed:** Yes — TypeScript adapters + additive Python bridge commands only. No domain SQL in TypeScript. `server.ts` untouched.

### Tools used

- Claude Code (claude-sonnet-4-6) across two sessions (context compacted between sessions)
- `Read` tool — schema.sql, contracts, hero_bridge.py, demo-seed.json, V31GraphWriteService, agent_runs DDL, orchestrator contracts, existing test doubles
- `Edit` / `Write` tools — all new TypeScript adapter files, Python handler additions
- `Bash` tool — `npm run typecheck`, `npm run test:coverage`, `python3.10 -m unittest`, grep for direct TS writes, secret scan

### Production adapters implemented

| Port | File | Contract |
|------|------|----------|
| M1 PostgreSQL snapshot | `src/agents/snapshot/pg-snapshot-builder.ts` | C2 |
| M2 Wallet specialist | `src/agents/wallet/wallet-agent.ts` | C3 |
| M2 Redemption specialist | `src/agents/redemption/redemption-agent.ts` | C3 |
| M2 EarningAgent stub | `src/agents/earning/earning-agent.ts` | C3 (excluded) |
| M3 Commit validation | `src/agents/commit/validation.ts` | C4 shared |
| M3 Controlled commit | `src/agents/commit/controlled-commit.ts` | C4 |
| M3 Python write bridge | `src/agents/commit/python-write-bridge.ts` | C6 |
| M4 AgentRun repository | `src/orchestrator/graph-write/agent-run-repository.ts` | C5 |
| M6 Bridge additions | `apps/api/bridge/hero_bridge.py` (additive) | C6 |

### Python bridge additions

8 new additive subcommands in `hero_bridge.py` (existing commands untouched):

| Subcommand | Description | Returns |
|------------|-------------|---------|
| `orchestrator-create-plan` | Create plan via V31GraphWriteService | `{planId, planLineageId, revisionNumber}` |
| `orchestrator-transition-plan` | UPDATE plans SET status | `{ok: true}` |
| `orchestrator-commit-step` | Create plan_step via V31GraphWriteService | `{mutationTxnId: plan_steps.id}` |
| `orchestrator-record-dependency` | Record state_dependency via V31GraphWriteService | `{mutationTxnId: state_dependencies.id}` |
| `orchestrator-record-mutation` | Write graph_mutations audit entry (no balance change) | `{mutationTxnId: uuid}` |
| `orchestrator-create-agent-run` | INSERT agent_runs (status=running) | `{agentRunId: uuid}` |
| `orchestrator-finalize-agent-run` | UPDATE agent_runs SET status, completed_at | `{ok: true}` |
| `read-plan` | Project plan via project_plan() (Contract 7 read path) | PlanView |

### Key decisions

1. **`plan_lineage_id` / `revision_number` resolution**: TypeScript callers provide only `plan_id`. The `orchestrator-commit-step` bridge handler fetches `plan_lineage_id` and `revision_number` from the `plans` table server-side. This avoids widening the frozen `AgentCommitBinding` interface.

2. **`CommitSuccess.mutationTxnId` as `planStepId`**: The frozen `CommitSuccess` interface has only `mutationTxnId`. For `RecordStateDependency`, the agent needs `plan_steps.id`. The bridge returns `plan_steps.id` as `mutationTxnId`, so agents can thread it forward. Documented as Contract Drift #2.

3. **LATERAL JOIN for `targetRedemptionOptionId`**: `user_goals` has `target_program_id`, not `target_redemption_option_id`. Resolved via LATERAL JOIN on `redemption_options` picking highest `cpp_basis_points`.

4. **`IdempotencyConflict` → `CommitSuccess(idempotencyReplayed: true)`**: Bridge may return this code; `ControlledAgentCommitFactory` catches and converts to success with sentinel `mutationTxnId = "idempotent-replay:{key}"`.

5. **Deterministic specialist ordering**: Wallet emits commits sorted by `programId`; Redemption branch logic is fully deterministic without any LLM invocation.

6. **`_psql_exec`/`_psql_rows` advisory lock caveat**: Each `execute()` in `_PsqlCursor` is a separate psql subprocess (separate transaction). `pg_advisory_xact_lock` is released immediately after each call. For the single-user thesis demo this is acceptable. Production use would require psycopg2 or a persistent connection.

### Validation commands run

```bash
npm run typecheck       # Clean — 0 errors
npm run test:coverage   # 179 passed, 4 skipped (live-PG gated)
python3.10 -m unittest discover -s tests -p "test_*.py"  # 203 passed, 10 skipped
grep -rn "CLERK_SECRET_KEY" apps/api/src/agents/ ...     # Only in comments
grep -rn "INSERT|UPDATE|DELETE" apps/api/src/agents/ ... # 0 direct TS writes
```

### Contract drift

| # | Description |
|---|-------------|
| 1 | `UserGoalRow.targetRedemptionOptionId` — no DB column in `user_goals`; resolved via LATERAL JOIN |
| 2 | `CommitSuccess.mutationTxnId` used as `planStepId` for `RecordStateDependency` — bridge returns `plan_steps.id` as `mutationTxnId` |
| 3 | `pg_advisory_xact_lock` doesn't span psql subprocess calls — acceptable for single-user demo |

### Tests added

- `src/agents/snapshot/pg-snapshot-builder.test.ts` — 12 unit + 4 live-PG (skipped)
- `src/agents/wallet/wallet-agent.test.ts` — 7 unit tests
- `src/agents/redemption/redemption-agent.test.ts` — 16 unit tests (full thesis flow coverage)
- `src/agents/commit/controlled-commit.test.ts` — 13 contract tests
- `src/orchestrator/graph-write/agent-run-repository.test.ts` — 7 contract tests
- `tests/test_orchestrator_bridge_commands.py` — 35 Python unit tests (all 8 subcommands + arg parser)

### Deferred / blocked

- Live-PG vertical integration test (Phase 8) — gated by `RUN_LIVE_POSTGRES_TESTS=1`; framework in place, requires seeded DB
- Phase 9 negative/safety tests — scaffolded but not exhaustive (subprocess timeout, extra stdout noise isolation tests skipped)
- Prompt C wiring — no HTTP route mounting; adapters ready for `PlanService → orchestrator` composition

### Deferred from code review (Prompt B remediation session, 2026-06-27)

The following findings were identified by two independent reviewers of the Prompt B branch and are deferred — not fixed in this session:

- **F-02** (`controlled-commit.ts:49-54`): `IdempotencyConflict` catch block is dead code — the bridge never emits `idempotency_conflict` for `orchestrator-commit-step`. The synthetic `mutationTxnId = "idempotent-replay:..."` is not a valid UUID and would break `RecordStateDependency` if it ever fired. Deferred pending bridge-side idempotency support in `orchestrator-commit-step`.
- **F-03** (`hero_bridge.py:1250-1285`): `idempotency_key` and `read_set` accepted by `orchestrator-record-dependency` are not forwarded to `V31GraphWriteService.record_state_dependency()`. No duplicate-row protection at DB layer for `state_dependencies`. Deferred: `RecordStateDependencyRequest` has no `idempotency_key` field; a schema change is required.
- **F-05** (`orchestrator.ts:159-168`): If both `finalizeAgentRun(completed)` and `finalizeAgentRun(failed)` throw, the `agent_runs` row stays in `status='running'` indefinitely. Deferred: needs a background reaper job or TTL column in schema.
- **F-06** (`wallet-agent.ts:28-42`): `stepOrder` is incremented but never used; suppressed with `void stepOrder`. Cosmetic only. Deferred until `wallet_agent` adds step-order semantics.
- **SEC-003** (`hero_bridge.py:199-211`): `_psql_literal` does not escape backslashes. On `standard_conforming_strings=off` (non-default), `\\x27` in user input can break out of a SQL string literal. Deferred: requires switching to psycopg2 or dollar-quoting; pre-existing pattern across the entire bridge, not introduced by Prompt B.
- **SEC-005** (`python-write-bridge.ts:95-142`): argparse treats any argv token starting with `--` as a flag. An `idempotency_key` or `error` string starting with `--` causes argparse to exit 2, producing `UnexpectedCommitError`. Deferred: full fix requires moving free-form data to stdin JSON.
- **SEC-006** (`hero_bridge.py:117, 156`): `os.environ.copy()` passes the full Python env to psql subprocesses. The TS allow-list filters before Python starts, but any library that appends to `os.environ` at import time bypasses it. Deferred: low exploitability in current threat model; fix by filtering the dict at the psql call sites.

### Secrets

No secrets recorded. `CLERK_SECRET_KEY` is explicitly excluded from the bridge env allow-list (`BRIDGE_ENV_ALLOWLIST` in `python-write-bridge.ts`). No `.env` values read or logged.

---

## Entry 012 — Option B Prompt C: C2 initial-Plan integration gate (2026-06-27)

**Branch:** `feat/orchestrator-thesis-integration` (base `904e579`, Prompt B merge `e3cec23`, remediation `64e734a` + `5a573c0`)

**Prompt B SHA integrated:** merge commit `e3cec23` (Prompt B head `94279e9` at integration time); post-merge remediation `64e734a` (SEC-001/002 ownership guards) and `5a573c0` (F-04 earning ownership table). Equivalent cherry-picks on `feat/orchestrator-production-adapters` tip `4951b51`.

**Scope:** Phases 2–7 of Prompt C C2 gate — production `PlanProjectionPort`, G1 parity, production composition, service-level initial Plan proof, `bootPlanService` pool wiring for `server.ts`, route-level live tests, go/no-go reset + second run.

### What was built

| Component | Path | Role |
|-----------|------|------|
| `BridgePlanProjection` | `apps/api/src/plans/bridge-plan-projection.ts` | Contract 7 — `read-plan` → `project_plan()` → runtime-validated `PlanView` |
| `DemoQueryDecomposer` | `apps/api/src/orchestrator/demo-decomposer.ts` | Deterministic Wallet + Redemption invocations for frozen demo |
| Production composition | `apps/api/src/plans/orchestrator-composition.ts` | `buildProductionOrchestratorDeps` + pool-based `composeOrchestratorPlanService` |
| Engine boot pool pass-through | `apps/api/src/plans/engine-selector.ts`, `server.ts` | `bootPlanService(env, { pool })` so orchestrator mode gets real adapters at boot |
| G1 parity test | `tests/plans/orchestrator-service.test.ts` | Bridge `get-plan` vs orchestrator `read-plan` on same persisted plan |
| Phase 5 live test | same | `OrchestratorPlanService.createPlan()` end-to-end |
| Route live tests | `tests/plans/routes-live.test.ts` | `POST /plans` + reset + second run |

### Live gate results (`RUN_LIVE_POSTGRES_TESTS=1`, local `rewards_test`)

| Gate | Result |
|------|--------|
| G1 projection parity | **PASS** |
| Phase 5 service-level initial Plan | **PASS** (wallet_agent → redemption_agent, rev 1, 4 mutations, 1 dependency) |
| Phase 6 route `POST /plans` | **PASS** |
| Phase 7 reset + second run | **PASS** |

### Offline validation

```bash
npm run typecheck          # clean
npm run test:coverage      # 203 passed, coverage floors met
```

### Checkpoint

**`C2 INITIAL PLAN GATE PASSED`** — initial Plan orchestration proven at service and route level with real PostgreSQL. Replanning (Phase 8+) not started.

### Unresolved / next

- C2 work is **uncommitted** on `feat/orchestrator-thesis-integration` (user requested commit after live gate passes).
- Phase 8+ (synchronous replan, rev 1 stale/superseded, browser integration, Prompt D handoff) remains.
- `pg` parallel-query deprecation warning during live tests (cosmetic; no functional failure).

## Entry 013 — CodeRabbit remediation on PR #53 (2026-06-28)

CodeRabbit reviewed PR #53 with 16 inline findings. Each was verified against the
current code; 14 were fixed with tests, 2 (Critical #1 + Major #4) were confirmed
valid and **deferred as architectural work** (no partial fix).

### Fixed (with tests)

- **Bridge ownership/lifecycle** (`hero_bridge.py`): plan-ownership guard before
  `agent_runs` INSERT; terminal-run finalize guarded by `status = 'running'` +
  `RETURNING` zero-row → `conflict`. Parser coverage for record-dependency /
  record-mutation.
- **Commit validation** (`validation.ts`): reject non-finite `balancePoints`
  before the `JSON.stringify` bridge boundary.
- **Redemption** (`redemption-agent.ts`): reject operations outside the Hyatt/Chase
  demo set (fail fast, no silent rewrite); Hyatt-only read-set on the
  direct/insufficient paths (Chase only on the transfer path).
- **Snapshot** (`pg-snapshot-builder.ts`): validate raw snake_case rows before
  coercion (null id/version, invalid goal_type); read the three tables under one
  `READ ONLY REPEATABLE READ` transaction.
- **Projection** (`orchestrator-service.ts`): `getPlanById` now applies
  `assertValidPlanView`, matching `createPlan`.
- **Boot/health** : extracted `createApp(deps)` (`app.ts`) from `server.ts` so the
  `PLAN_ENGINE` → `/health` engine contract is testable; added the test.
- **Test fidelity**: `FakeEarningAgent` now throws like production `EarningAgent`;
  benign third-agent role moved to an explicit `NoOpEarningAgent`. Replaced the
  `sk_live_*`-shaped Clerk fixture with an inert placeholder.
- **Docs**: corrected stale paths in `architecture-option-b.md` /
  `c1-integration-audit.md`.

### Deferred (confirmed valid; architectural)

Findings #1 (atomic read-set OCC + idempotency) and #4 (replay metadata) require a
read-set protocol change, a single-transaction `orchestrator-commit-batch`, and a
durable idempotency schema. Design + demo guardrails captured in
[`deferred-occ-idempotency-design.md`](docs/plans/option-b/deferred-occ-idempotency-design.md).
The demo is single-user and sequential with no write retries; **no production
idempotency or atomic cross-command OCC is claimed**, and `python-legacy` remains
the rollback engine.

### Validation

- `npm run typecheck` → 0 errors.
- `npm run test:coverage` → 211 passed / 9 skipped; functions 91.02% (≥88%),
  branches 85.49% (≥76%).
- `python3.10 -m unittest discover -s tests -p "test_*.py"` → 213 passed / 10 skipped.

---

## Entry 014 — Demo-observability UI + user-driven replan (2026-06-27)

**Task:** Teammate-2 demo-observability lane (compact agent-activity panel bound to
real evidence) + a user-driven replan flow ("I transferred X points" → re-plan),
plus an Option B contracts doc-fix.
**Branch:** `chore/option-b-shared-baseline`
**Production code changed:** Yes (frontend only; no Hono routes, no backend contracts)

### Tools used

- Claude Code (Opus 4.8, 1M context) — investigation, implementation, tests
- `Read`/`Bash`/`Grep` — traced live SSE wiring, contracts, planner behavior
- `python3` — ran `agents/redemption/planner.py` to verify the rev-1 transfer amount

### Files modified

- `lib/plan/activity.ts` (NEW) — frontend-only typed orchestration-evidence model
  (runId, specialist, operation, status, snapshot/state version, start/end, validation,
  commit result/failure class, plan-revision transition).
- `components/onboarding/AgentActivity.tsx` (NEW) — pure-props accessible panel
  (ordered list, color-independent lifecycle glyphs + SR text, loading/empty/failed/
  complete states).
- `lib/api/activity-adapter.ts` (NEW) — maps the **real** `/api/mutations/stream`
  events to a trace; leaves backend-gated fields `undefined` (no fabrication).
- `components/onboarding/AgentActivityLive.tsx` (NEW) — thin SSE shell feeding the
  pure component from the live endpoint.
- `lib/api/types.ts` — extended `RealMutationEvent` with `agent_run_id`,
  `mutation_txn_id`, `committed_at` (fields the wire already carries).
- `lib/api/activity-adapter.test.ts`, `components/onboarding/AgentActivity.test.tsx`
  (NEW) — 17 tests (ordering, distinct specialists, lifecycle transitions, empty/
  error, a11y semantics, no-fabrication).
- `app/api/plan/stream/route.ts` — replan branch accepts user transfer params
  (`?src=&dest=&amt=`); falls back to the seeded persona when absent. Positive-amount
  validation. (BFF route; Hono routes untouched.)
- `components/onboarding/AgentConsole.tsx` — "I transferred points" control
  (program pickers from real `/api/me` balances + amount), revives `openStream(true)`,
  and a replan summary block (rev N−1 superseded → rev N current, before→after
  balances, removed transfer step).
- `components/onboarding/OnboardingFlow.tsx` — passes real `me.balances` to the console.
- `docs/plans/option-b/{orchestrator-thesis-contracts,architecture-option-b}.md` —
  corrected the rev-1 recommended transfer (15k/30k → **45,000**, verified against the
  planner), distinguished it from the 30k demo *trigger* transfer, filled the baseline SHA.

### Key decisions / findings

1. **No fixtures, no fake stream.** Per the lane rules, the panel binds to the real
   mutations SSE and the replan calls the real `POST /balance-transfer`. Fixtures live
   only in tests.
2. **Honesty boundary (the "why" for what's missing).** The live `MutationEvent`
   contract carries no snapshot version / validation / distinct-specialist identity
   (`agent_run_id` is null on the legacy runtime). The model has typed slots for these
   but the adapter leaves them `undefined` until the orchestrator (M4/M9) is mounted —
   so thesis claims 2/3/4 are **backend-gated**, while 6/7/9 (revision committed →
   invalidated → superseded) are demonstrable from real data today.
3. **Rev-1 transfer amount corrected to 45,000** — the planner recommends the winning
   Ginza award's full cost at the 1:1 path and does not net out the existing 30k Hyatt
   balance (verified by running the planner at balance 180,000). Flagged as an open
   item for the M2 redemption-adapter owner.
4. **Lane-boundary note:** the replan trigger touches a BFF route + replan-trigger
   logic, which under strict Teammate-2/integration separation is integration-lane
   work. Done here at explicit user direction on the single shared branch; no Hono
   route or backend contract was changed.

### Validation

| Command | Result |
|---|---|
| `npx tsc --noEmit` (web) | ✓ clean (2 pre-existing pg-env warnings filtered; CI green) |
| `npx vitest run` (web) | ✓ 171 passed (154 prior + 17 new) |

### Deferred / pending

- Presentation artifacts (Phase 5: diagrams, narration, screenshots) — intentionally
  omitted at user direction ("no demo things").
- Claims 2/3/4 remain blocked on the orchestrator backend; the UI will populate the
  existing typed slots with zero rework once `agent_run_id` + richer fields arrive.

### Secrets

No secrets recorded. No `.env` read; tokens never logged.

---

## Entry 015 — Real benchmark report tabs + review hardening (2026-06-27)

**Task:** Replace the fabricated baselines/benchmark comparison constants with a
captured **real** benchmark report, and resolve a code-review pass on the
demo-observability + replan work.
**Branch:** `chore/option-b-shared-baseline`
**Production code changed:** Yes (frontend + one Python report generator; no Hono
routes, no backend contracts)

### Benchmark report (replaces fabricated metrics)

- `scripts/build_benchmark_report.py` (NEW) — runs the fixture-backed typed scorer
  (`benchmark.person_c_scorer`, real, no key) and merges committed LLM-baseline
  reports if present; emits `lib/benchmark/architecture-comparison.json`. Baselines
  with no report are `not_run` (never fabricated). Tolerant of empty/partial files.
- `lib/benchmark/report.ts` (NEW) — typed loader for the captured report.
- `components/onboarding/{BenchmarkView,ContrastView}.tsx` — rewired to render the
  real report (typed measured: accuracy 30/30, 0 hallucinations, invalidation 5/5;
  baselines show `not run` + the command to produce them). Dropped the
  `deriveComparison` constants and invented accuracy/hallucination fixtures.
- Token-cost row omitted: needs LLM-in-loop + `agent_runs.token_count` (deferred).
- To fill baselines: `OPENAI_API_KEY=... python -m benchmark.single_agent_baseline
  > benchmark/reports/single_agent_llm_baseline.json` (and the free-text baseline),
  then re-run the generator. The plan-tab header "tokens vs baseline" chip is still
  the old illustrative estimate — flagged for a follow-up.

### Code-review fixes (verified against current code)

- `lib/api/activity-adapter.ts` — `runId` now uses `event_id` (unique per row) so
  several mutations from one `agent_run_id` can't collide React keys.
- `components/onboarding/AgentActivityLive.tsx` — dedupe streamed events by
  `event_id` so EventSource auto-reconnect can't replay/duplicate rows.
- `app/api/plan/stream/route.ts` — `parseUserTransfer` is **fail-closed**: any
  partial/invalid/same-source/non-positive user tuple → 400, never a silent persona
  fallback; persona fallback only when no transfer params are present.
- `components/onboarding/AgentConsole.tsx` — transfer flow reads/refreshes
  `liveBalances` (refetched from `/api/me` after each replan) instead of the stale
  prop, and a synchronous in-flight guard prevents double-submit launching two
  replans.

### Tests added/updated

- Replan flow (AgentConsole): control visibility, same-src/dest + over-balance
  validation, query-param forwarding, summary (removed step + before→after deltas +
  revision badges).
- `AgentActivityLive`: SSE setup, append, dedupe on replay, open/error phases,
  unmount cleanup.
- Adapter: `event_id` row identity, `committed_at`→`endedAt`.
- Route: user-transfer precedence over persona, fail-closed 400 cases, persona-only
  fallback.
- Benchmark loader + both tab components (report-driven).

### Validation

| Command | Result |
|---|---|
| `npx tsc --noEmit` (web) | ✓ clean (2 pre-existing pg-env warnings filtered) |
| `npx vitest run` (web) | ✓ 191 passed |
| `python scripts/build_benchmark_report.py` | ✓ typed measured; baselines not_run |

### Secrets

No secrets recorded. No `.env` read; API keys never logged or committed.

---

## Demo Sprint Joint Freeze — Hour 0–1 baseline (2026-06-28)

Coordinator pass to let two contributors split from one baseline. Read-only on
product code; one new doc created (`docs/demo/DEMO_SPRINT_FREEZE.md`). No agent
or schema refactor; replan deliberately not touched.

### Tools used
- Claude Code (Opus 4.8): one parallel `Explore` agent for contract/fixture/seam
  inventory; `Bash` for git, `psql`, `vitest`, `python3.12` benchmark modules;
  small Python audit snippets (no files committed); `Read`/`Write` for the freeze doc.

### Important decisions
- **Canonical wallet = live `demo-seed-v1` persona** (`clerk_hero_demo`/`…a001`),
  not the benchmark fixture, because the graph orchestrator must read canonical
  PostgreSQL. Transfer-required invariant numerically proven (Hyatt 30k < Ginza 45k;
  +15k Chase→Hyatt @1:1 → affordable). Shortfall = 15,000 pts.
- **Canonical query frozen** verbatim (architecture-neutral phrasing) for a fair
  three-way grounding comparison; adapters must override existing test/gold strings.
- **Normalized comparison contract frozen in the doc** (no shared TS workspace exists;
  adding one would be an out-of-scope architectural change). Person B owns the
  code-level type post-split.
- Single-writer rule assigned for shared route registration (Person A) and shared
  comparison types (Person B).

### Validation commands
| Command | Result |
|---|---|
| `git status` / `git rev-parse HEAD` | clean, SHA `6c388cb`, in sync with `origin/main` |
| `python3.12 scripts/load_seed.py fixtures/demo-seed.json --include-demo-persona` | ✓ persona restored (idempotent upsert; smoke seed preserved) |
| `vitest run orchestrator-service.test.ts -t "Phase 5"` (live PG, `PLAN_ENGINE=orchestrator`) | ✓ rev1 current, wallet→redemption, 4 mutations, 1 dep |
| `python3.12 -m benchmark.single_agent_baseline --limit 1 --pretty` (live) | ✓ exit 0, 1 call, 2,050 tok, Ginza correct |
| `python3.12 -m benchmark.free_text_multiagent_baseline --limit 1 --pretty` (live) | ✓ exit 0, 4 roles, 8,367 tok, Ginza correct |

### Manual review / findings caught
- **Live DB had been re-seeded by a parallel process** (generic `clerk_rcg12` smoke
  seed); demo persona was missing. Restored non-destructively. DB flagged volatile.
- **Grounding flag is an evaluator artifact, not a hallucination:** both baselines'
  `award_not_in_tool_result` traces to `balance:user_mvp_demo:chase_ur` — supplied in
  the prompt but omitted from `person_c_scorer.py::_fixture_fact_slugs`. Classified
  `EVALUATOR_BOUNDARY_MISMATCH`. Fix assigned to Person B.
- **Input worlds differ:** graph uses `demo-seed-v1` (Chase 180k/Hyatt 30k); baselines
  use `person-c-mvp` (Chase 75k, no Hyatt). Classified `SEPARATE_DATA_WORLDS` — no fair
  comparison may be claimed yet.
- `python3` is 3.14.2 (wrong); CI/baselines require `python3.12`.

### Deferred / blocked
- Orchestrator replan (steps stay `proposed`; invalidation needs `current`) — Person A lane.
- Data-world + query alignment, evaluator balance-slug fix, code-level comparison type — Person B lane.
- Hosted verification not performed (`API_BASE_URL` is localhost).

### Secrets
No secret values printed or stored; env vars reported as present/absent only.
`.env`/`apps/api/.env` confirmed git-ignored. DB password/OpenAI key passed via
command substitution, never echoed.

### Verdict
`JOINT FREEZE COMPLETE — DATA ALIGNMENT REQUIRED`

---

## Person A — Live TypeScript Orchestrator Replan (2026-06-28)

**Task:** Repair the live TS orchestrator replan vertical slice so the hero flow
works end to end: rev1 (orchestrator) → transfer 15k Chase→Hyatt → dependency
invalidation → one replan job → TS orchestrator re-entry → rev2 current with
fresh Wallet + Redemption AgentRuns → rev1 superseded → exactly one current.
**Branch:** `demo/orchestrator-replan` (worktree `Capstone/gpFree-replan`, from
freeze `a3b65fd`). **DB:** dedicated `rewards_replan` (schema + `demo-seed-v1`).
**Production code changed:** Yes (orchestrator service/composition, orchestrator
core, Python write boundary for replan lifecycle + reset).

### Tools used
- Claude Code (Opus 4.8) — `ce-work` execution skill.
- `Explore` subagents (3, parallel) — traced the replan/mutation lifecycle, the
  orchestrator finalization seam, and the reset/idempotency/live-test harness.
- `Read`/`Grep`/`Edit`, `Bash` (psql, vitest, tsc, python3.12 unittest).

### Important implementation decisions
1. **Step promotion at the single final boundary (S2).** `do_orchestrator_transition_plan`
   (reached from `orchestrator.ts` after every specialist) now promotes a plan's
   `proposed` steps → `current` atomically (via `_psql_tx`) when the plan goes
   `→current`; never on `→failed`. This unblocks BOTH staleness paths
   (`mark_direct_plan_dependents_stale` + the `user_balances` backstop trigger),
   which match only `plan_steps.status='current'`.
2. **TS-driven cross-process re-entry (S4/S5).** The orchestrator-mode transfer no
   longer delegates revision generation to the legacy Python flow. New narrow
   bridge primitives over the existing controlled write boundary:
   `balance-transfer-apply` (mutation + stale rev1 + enqueue job, NO generation),
   `replan-promote` (claim + `promote_replan_job_success`), `replan-fail`; and
   `orchestrator-create-plan` extended with `--revision-number`/`--supersedes-plan-id`.
   `Orchestrator.runRevision` builds rev2 in the EXISTING lineage and leaves it
   `generating` (the promotion SQL requires `generating` and atomically flips
   rev2→current, rev1→superseded, and promotes rev2 steps). `createRevisedPlan`
   on `OrchestratorPlanService` orchestrates apply → runRevision → promote, with
   projection of rev2 to `PlanView`. Public `/balance-transfer` contract unchanged.
3. **Failure stays visible (S6).** On any re-entry failure: the partial rev2 is
   marked `failed`, the replan job is failed, and rev1 stays `stale` — no silent
   fallback. Cleanup failures during failure-handling are swallowed so the
   original error surfaces.
4. **Deterministic reset (S7).** `do_demo_reset` now also clears scoped
   `idempotency_records` + `agent_runs` (which don't cascade on a plans delete —
   `agent_runs.plan_id` is `ON DELETE SET NULL`), so a repeated identical transfer
   creates a fresh mutation + job instead of replaying an idempotent result.
   Scoped to the demo `user_id` only.

### Validation commands and results
| Gate | Command | Result |
|---|---|---|
| API typecheck | `tsc --noEmit` (apps/api) | ✓ 0 errors |
| Orchestrator/API unit tests | `vitest run` (apps/api) | ✓ 224 passed, live-gated skipped |
| Python bridge/flow/mutations | `python3.12 -m unittest …` (5 modules) | ✓ 86 passed, 1 skipped |
| Live initial-Plan (Phase 5) | full live suite (below) | ✓ PASS |
| Live replan (Phase 8) | full live suite | ✓ PASS — rev2 current, fresh wallet+redemption AgentRuns |
| Reset/repeatability (Phase 8b) | full live suite | ✓ PASS — run 2 distinct rev2+job, fresh mutation |
| Live G1 projection parity | full live suite | ✓ PASS |
| Hidden-fallback scan | grep | ✓ legacy generator confined to `python-legacy do_balance_transfer` |
| Direct-TS-domain-write scan | grep `apps/api/src` (excl. tests) | ✓ zero — all writes via the Python boundary |
| Secret scan | grep changed files | ✓ none |

Full live suite (pristine `rewards_replan`):
```bash
cd apps/api && RUN_LIVE_POSTGRES_TESTS=1 PLAN_ENGINE=orchestrator PYTHON_BIN=python3.12 \
  DATABASE_URL=… PG*=… \
  npx vitest run tests/plans/orchestrator-service.test.ts
# 22 passed (0 skipped): G1×2, Phase 5, Phase 8, Phase 8b
```
Replan evidence: Chase 180000→165000 (v1→v2), Hyatt 30000→45000 (v1→v2); rev1
superseded, rev2 current, one replan job `completed`, exactly one current plan,
rev2 AgentRuns `[wallet_agent, redemption_agent]`.

### Manual review / findings caught
- Wallet + Redemption specialists are **deterministic (no LLM/network)** — live
  replan tests need only PostgreSQL, not `OPENAI_API_KEY`.
- `promote_replan_job_success` (schema.sql) already promotes rev2 steps and does
  the full lifecycle atomically, requiring rev2 to be `generating` — so
  `runRevision` deliberately does NOT self-promote (would break the precondition
  and risk two currents; the DB's `plans_one_current_revision` partial unique
  index is the backstop).
- The task's `../gpFree-replan` path assumed a different cwd; the real worktree is
  `Capstone/gpFree-replan`. `PYTHON_BIN=python3.12` is required (`python3` is 3.14).

### Files changed (Person A lane only — no Person B files)
`apps/api/bridge/hero_bridge.py`, `apps/api/src/orchestrator/{orchestrator,contracts}.ts`,
`apps/api/src/orchestrator/graph-write/agent-run-repository.ts`,
`apps/api/src/agents/commit/python-write-bridge.ts`,
`apps/api/src/plans/{orchestrator-service,orchestrator-composition}.ts`,
`apps/api/tests/plans/{orchestrator-service,orchestrator-composition}.test.ts`.
Infra: `npm ci` in `apps/api` to restore declared deps (no dependency change).

### Deferred / blocked
- Re-entry failure path is unit-tested (service-level), not live-fault-injected.
- No new queue/worker, no graph-wide transitive invalidation, no multi-mutation
  types, no UI — out of scope per the sprint brief.

### Integration contract
Person B **may enable** "Simulate completed transfer" in the UI: the live replan
is verified (rev2 current, fresh AgentRuns, exactly one current, repeatable) and
sits behind the unchanged `POST /balance-transfer` contract.

### Verdict
`LIVE TYPESCRIPT REPLAN VERIFIED`

---

## Person A — Post-Implementation Code Review (2026-06-28)

**Scope:** Read-only adversarial review of the uncommitted replan work on
`demo/orchestrator-replan` (HEAD `a3b65fd`; 10 files in working tree). No code
modified during review.

### Mounted-path proof
`POST /balance-transfer` → `routes.ts:65` `service.transferBalance` →
(orchestrator mode, `engine-selector.ts:130` → `composeOrchestratorPlanService`)
`OrchestratorPlanService.transferBalance` → `replan.applyTransfer`
(`balance-transfer-apply`, mutation only) → `orchestrator.runRevision` (TS
specialists generate rev2) → `replan.promote` (`promote_replan_job_success`).
Legacy `BridgePlanService.transferBalance`/`replan_after_balance_transfer` is
reachable ONLY in `python-legacy` mode. No cross-engine fallback.

### Live lifecycle proof (pristine `rewards_replan`, Phase 8 single cycle)
- rev1 `transfer_recommendation` step (Chase→Hyatt), status promoted `current`,
  dependency `user_balances.balance_points obs_version=1`.
- transfer 15k: Chase 180000→165000 (v1→v2), Hyatt 30000→45000 (v1→v2).
- exactly one replan job, `completed`, `src=rev1 result=rev2`.
- **rev2 `redemption_recommendation` step (direct Hyatt→Ginza) — recomputed from
  the fresh snapshot; the transfer step is dropped.** dependency obs_version=2.
- rev1 `superseded`, rev2 `current`, fresh wallet+redemption AgentRuns on both,
  `current count = 1`. Repeatability (Phase 8b) run1≠run2 rev2/job, fresh mutation.

### Commands
| Command | Pass | Fail | Skip | Proves |
|---|---:|---:|---:|---|
| `tsc --noEmit` (apps/api) | — | 0 | — | typechecks |
| `vitest run` (apps/api) | 224 | 0 | 12 | unit + service re-entry/failure units |
| `vitest -t "Phase 8 —"` (live) | 5 | 0 | 17 | live replan revision-two |
| full live suite | 22 | 0 | 0 | G1 + initial + replan + repeatability |
| `unittest` (5 bridge/flow/mutation modules) | 86 | 0 | 1 | bridge/reset refactor intact |
| hidden-fallback / direct-write / test-double / secret scans | ✓ | — | — | no fallback, no direct TS writes, no doubles/secrets |

### Findings
- **P2 — duplicate transfer without reset → spurious failed revision + 500.**
  `orchestrator-service.ts transferBalance` + `hero_bridge.py do_balance_transfer_apply`.
  Re-applying the identical transfer replays the mutation (balances safe,
  `replanJobId: null`), but the service then generates a stray rev (generating),
  finds no claimable job, fails it, and throws (500). One-current + balances
  preserved; leaves a `failed` revision. Fix: surface an `idempotencyReplayed`
  flag from apply and short-circuit to the existing current plan.
- **P2 — re-entry failure path not live-verified; job ends `pending` not terminal.**
  Failure flow proven only via mocked `ReplanPort`; no live fault injection.
  `max_attempts=3` so `do_replan_fail` claim+fail leaves the job `pending`
  (retryable) but there is no worker to retry. Fix: add a live fault-injection
  test (rev2 failed / rev1 stale / job terminal) and/or force the job terminal.
- **P3 — no focused test for "failed plan does not promote steps"** (S2 brief
  required it); correct by the `if status=='current'` guard, untested.
- **P3 — `ReplanApplyResult.replanJobId` typed non-nullable but is `null` on
  replay** (type lie; no crash).
- **P3 — projection failure after a successful promote surfaces as 500** though
  the replan committed.

### Verdict
`PERSON A APPROVED WITH NON-BLOCKING FINDINGS` — the replan claim is VERIFIED for
the hero path (mounted, live-proven, recomputed rev2, repeatable, no legacy
generation). Findings are edge cases that do not break the hero path or corrupt
data. **Integration:** Person B may enable "Simulate completed transfer" **if the
UI resets before each transfer or disables the control after one** (otherwise the
P2 duplicate-click path returns a 500 + stray failed revision). Verified contract:
`POST /balance-transfer {sourceProgramId,destProgramId,amountPoints,idempotencyKey?}`
→ `{planLineageId, staledPlanId, replanJobId, currentPlan: PlanView(rev2,current)}`.

---

## Entry 016 — Person A Review Fixes (2026-06-28)

**Task:** Address all non-blocking findings from Entry 015 Person A Review
**Branch:** `demo/orchestrator-replan`
**Files modified:** `apps/api/bridge/hero_bridge.py`, `apps/api/src/agents/commit/python-write-bridge.ts`, `apps/api/src/plans/orchestrator-service.ts`, `apps/api/tests/plans/orchestrator-service.test.ts`
**Production code changed:** Yes — `hero_bridge.py`, `python-write-bridge.ts`, `orchestrator-service.ts`

### Commits

| SHA | Message |
|---|---|
| `9208f5c` | `feat(orchestrator): re-enter specialists for balance replanning` |
| `501df8f` | `fix(replan): return current plan for idempotent transfer replay` |
| `6216609` | `test(orchestrator): cover replay and failed step promotion` |

### What was done

**Step 1 — Commit verified implementation**
Committed the 10 pre-existing modified files (orchestrator replan implementation) that were live-verified per Entry 015 as the initial commit.

**Step 2 — Fix duplicate idempotent transfer (P2 finding)**
- `hero_bridge.py do_balance_transfer_apply`: capture `transfer_points` result; read `idempotency_replayed`; return `idempotencyReplayed` in the response dict; return `replanJobId: None` on replay (no new job was created).
- `python-write-bridge.ts ReplanApplyResult`: typed `replanJobId: string | null` and added `idempotencyReplayed: boolean`.
- `orchestrator-service.ts ReplanApplyOutcome`: same nullability + flag. `createRevisedPlan` param typed `replanJobId: string | null`.
- `orchestrator-service.ts transferBalance`: added replay short-circuit after `applyTransfer` — if `idempotencyReplayed`, fetch existing current plan via `readDelegate.getCurrentPlan` and return immediately; no revision, no promotion.

**Step 3 — Regression tests**
- Unit: `transferBalance` replay short-circuit — asserts `runRevision`, `promote`, `fail` not called; `getCurrentPlan` called; `result.currentPlan` = existing plan; `result.replanJobId` is null.
- Unit: replay with no current plan → throws `OrchestratorPlanError`.
- Live-PG (Phase 8c): second identical transfer succeeds, returns same rev2 (not rev3), `replanJobId` null, balances 165k/45k unchanged, exactly 2 plan rows, 1 replan job, same agent run count.

**Step 4 — Failed step promotion test (P3 finding)**
Added: `"a failed revision leaves no steps promoted"` — asserts `promote` not called when `runRevision` returns `status: 'failed'`.

**Step 5 — Type correctness**
Ran `tsc --noEmit` with no errors. No non-null assertions used. Fixed the type lie (`replanJobId: string` → `string | null`) without casting.

**Step 6 — Live fault-injection path**
Deferred — the production composition has no seam for injecting a failing runner without wiring a new interface. The unit test at `"fails the replan job and surfaces the error when the orchestration fails"` (line ~272) covers the fail path with a mocked runner. The missing live test is deferred to a future fault-injection harness.

### Validation results

| Command | Pass | Fail | Skip | Proves |
|---|---:|---:|---:|---|
| `tsc --noEmit` (apps/api) | — | 0 | — | no type errors, no non-null assertions |
| `vitest run` (apps/api, targeted) | 26 | 0 | 6 | replay unit + failed-promotion unit |
| `vitest run` (apps/api, full) | 227 | 0 | 13 | full suite unchanged |
| `unittest test_orchestrator_bridge_commands` | 45 | 0 | 0 | Python bridge intact |
| hidden-fallback scan | ✓ | — | — | no `python-legacy` or `replan_after_balance_transfer` in production TS |
| secret scan | ✓ | — | — | no hardcoded secrets |
| Live-PG Phase 8c | skipped | — | — | rewards_replan DB not available in this session |

### Before / After — duplicate transfer behavior

**Before:** Second identical `POST /balance-transfer` without reset → Python `do_balance_transfer_apply` returns `replanJobId: <job_id>` even though the replay created no new job → `createRevisedPlan` attempts to promote a non-existent job → SQL function returns error → `OrchestratorPlanError` thrown → HTTP 500. Leaves a `failed` revision artifact.

**After:** `idempotencyReplayed: true` flows from Python → TypeScript bridge → service. `transferBalance` short-circuits, fetches the existing current plan (rev2) via `readDelegate.getCurrentPlan`, returns `{currentPlan: rev2, replanJobId: null}` → HTTP 200. No new revision, no new job, no job promotion attempt.

### Deferred

- **Live fault-injection test** (Step 6): re-entry failure leaves rev1 stale + rev2 failed + no current promoted. The production composition has no seam for a failing runner. Deferred to a future fault-injection harness.
- **P3 — projection failure after successful promote** surfaces as 500 though replan committed. Out of scope for this fix iteration.

### Integration decision

**Person B may safely enable "Simulate completed transfer" without requiring a reset between clicks.** The P2 duplicate-click path now returns HTTP 200 with the existing current plan (same rev2, same balances) instead of HTTP 500. The UI does not need a hard reset between transfers — a second click of the same transfer is idempotent and safe.

---

## 2026-06-28 — Person B — Three-Architecture Comparison Vertical Slice

Branch `demo/test-wallet-comparison` (worktree `../gpFree-comparison`). Built the
initial three-way comparison: live graph orchestrator vs free-text chat crew vs
single-agent baseline, over one canonical wallet and one canonical query, scored
by one deterministic evaluator.

### Tools used
- Cursor agent (Claude) for implementation, TDD, and review.
- `vitest` (API + web), Python `unittest` for baseline alignment + scorer grounding.
- `tsc --noEmit` (API and web), `next build`, `git`, `rg`.

### Important implementation decisions
- **Adapters normalize, the endpoint evaluates.** Each adapter returns a
  `NormalizedPlan` + metrics + evidence with no `evaluation` field; the endpoint
  applies the single evaluator to all three. This makes "no architecture-specific
  scoring" structurally true — an adapter has no scoring code to bias.
- **One canonical source** (`apps/api/src/comparison/canonical-wallet.ts`) for
  public facts + `CANONICAL_QUERY`. Private gold (`expected_top_award_slug`) lives
  only in `benchmark/gold/demo-comparison-cases.json`, never in agent input or the
  `GET /demo/test-wallets` response.
- **Evaluator boundary fix (`_fixture_fact_slugs`):** balance slugs supplied to the
  model are now grounded; correctness and grounding stay separate fields. Added
  `fixture_fact_slug_sources` to categorize each slug's origin.
- **Deterministic evaluator** (`evaluator.ts`): hard-validity gates (grounding,
  supported route, affordability via balance simulation, negative balance, falsely
  claimed goal) + lexicographic ranking (goal → feasibility → redemption value →
  fewer unnecessary transfers → fewer steps → preserved flexible points). No LLM
  judge, no weighted score.
- **Honest baseline normalization:** prose steps are parsed for action/points/
  programs; a transfer is never invented. An architecture-independent helper
  (`fillImpliedTransferAmounts`) fills the deterministic deficit (award cost −
  starting balance) when a transfer names a destination but omits the number — the
  same helper runs for the graph (whose `PlanView` carries transfers as edges
  without amounts), so neither side is flattered.
- **Graph normalizer reads the typed graph** (`PlanView.graph` edges/nodes) for the
  selected award, redeeming program, and transfer route; synthesizes the transfer
  step the view omits as a step so the evaluator can credit it.
- **Endpoint** `POST /demo/architecture-comparison`: validates the approved wallet
  id, resolves facts server-side, runs all three with `Promise.allSettled`,
  attaches evaluations, returns three independent results; one failure stays
  isolated (HTTP 200). `GET /demo/test-wallets` exposes public facts so the UI
  never hard-codes balances.
- **Web** `/test-wallets`: server-fetches facts, client runs the comparison via a
  proxy route, three cards render loading/success/failure with steps, separate
  correctness + grounding, latency, and tokens. Replan button disabled (Step 10
  gate). Landing "Start Optimizing" routes to `/test-wallets`.
- **Type mirroring** (no shared TS workspace): `lib/comparison/types.ts` hand-mirrors
  the API contract; `GraphPlanRunner` narrows the `PlanService` dependency (ISP) so
  the adapter and its tests need only `createPlan`.

### Validation commands
| Command | Result |
|---|---|
| `vitest run src/comparison/` (API) | ✓ 43 passed (contracts, adapters, evaluator, endpoint incl. partial-failure) |
| `vitest run` (API, full) | ✓ 263 passed, 10 skipped (live PG) |
| `vitest run` (web, full) | ✓ 204 passed (incl. 12 new comparison tests) |
| `python3.12 -m unittest tests.test_demo_comparison_baseline_alignment tests.test_person_c_scorer_grounding` | ✓ 13 passed |
| `tsc --noEmit` (API) | ✓ clean |
| `tsc --noEmit` (web) | ✓ clean |
| `next build` | compiles; static prerender of pre-existing Clerk pages fails (no `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in worktree) — not in changed code; `/test-wallets` is `force-dynamic` |
| secret scan (`rg` over diff) | ✓ no secret literals; no forbidden replan/orchestrator paths touched |
| live graph run | ✗ NOT RUN — `rewards_comparison` DB unreachable / PG env unset in this worktree |
| live chat-crew run | ✗ NOT RUN — `OPENAI_API_KEY` unset in this worktree |
| live single-agent run | ✗ NOT RUN — `OPENAI_API_KEY` unset in this worktree |

### Manual review / findings caught
- Baseline program matcher first read "transfer Chase to Hyatt" as a Hyatt→Hyatt
  self-transfer (only full program names matched, not the short brand "Chase"),
  netting zero and failing affordability. Broadened the matcher to issuer + brand
  words; added a regression test.
- Evaluator reads transfers from `plan.steps`, not the top-level `transferAmount`;
  the graph `PlanView` carries no step amounts, which would have failed the graph
  unfairly — resolved with the shared implied-amount helper.
- `next build` failure is environmental (missing Clerk key), confirmed unrelated to
  the new code by the failing path list (all pre-existing Clerk pages).

### Deferred / blocked
- **Three live runs not executed** in this worktree (no `OPENAI_API_KEY`, no
  `rewards_comparison` DB / PG env). Deterministic behavior is fully covered by
  fixture-backed adapter/normalizer/evaluator/endpoint tests, but per the freeze
  skipped live tests are not counted as passing → verdict PARTIAL.
- Step 9 (Direct Redemption / Insufficient Points wallet tabs): UI renders tabs
  for any wallet the API exposes; only `transfer-required` is exposed for the
  vertical slice, so no second tab yet. No fake frontend wallets added.
- Step 10 (replan "Simulate completed transfer"): disabled with no working claim,
  pending Person A `LIVE TYPESCRIPT REPLAN VERIFIED`.

### Secrets
No secret values printed or stored; availability reported as set/unset only.
No credentials committed; `.env` is absent in this worktree.

### Verdict
`THREE-WAY COMPARISON PARTIAL` — all six 4-hour checkpoint items met (contracts
compile, canonical wallet + verbatim query feed all three, evaluator false-positive
fixed, all three adapters execute under test, one endpoint response returns three
independent results); live execution of the three architectures is the only
outstanding item, blocked on credentials/DB in this worktree.

---

## 2026-06-28 — Person B Post-Implementation Code Review (read-only audit)

Independent post-implementation review of `demo/test-wallet-comparison`
(worktree `../gpFree-comparison`, HEAD `b701fde`) against the joint freeze
`a3b65fd`. Read-only: no production code modified; only this append.

### Tool used
- Cursor agent (Claude) via `/ce-code-review` with a custom 10-phase audit
  prompt. `Read`/`Grep`/`Glob` for the full diff; `git` for history; `vitest`,
  `tsc`, `python3.12 unittest`, `next build` for verification.

### Verdict
`PERSON B THREE-WAY COMPARISON NOT VERIFIED` — the implementation is complete,
deterministic, and merge-ready as a vertical slice, but no architecture was
executed live (no `OPENAI_API_KEY`, no `rewards_comparison` DB, no running
backend in this worktree) and the browser hero flow was not run. The comparison
claim is proven at the contract/test level, not end-to-end. Matches Person B's
own honest `THREE-WAY COMPARISON PARTIAL`.

### What was verified (passing)
- No gold leakage: `expected_top_award_slug`/`required_checks` live only in the
  scoring record, never in `_user_prompt` (both baselines).
- No test doubles in production comparison code; no secret literals in the diff.
- Evaluator (`evaluator.ts`) is pure, architecture-blind, recomputes
  goalSatisfied/affordability by balance simulation (does not trust adapters).
- Input equivalence proven statically: `canonical-wallet.test.ts` ties the
  canonical object to BOTH `fixtures/demo-seed.json` (graph) and
  `fixtures/demo-comparison-baseline.json` (baselines) + the cases query;
  Python alignment tests prove both baselines receive identical seeded facts +
  the verbatim canonical query.
- Endpoint: walletId allow-listed, facts resolved server-side, no user-id
  injection, `Promise.allSettled` isolates a single failure (HTTP 200), no gold
  in `GET /demo/test-wallets`.
- Grounding fix (`person_c_scorer.py`) adds balance slugs + source categories
  without making arbitrary identifiers valid.
- UI renders all model output via JSX (auto-escaped); no streaming claim; no
  LLM-picked "best" badge; balances from server facts.

### Findings (none P0/P1)
- P2 `apps/api/src/app.ts` edited directly by Person B (Person-A-owned route
  registration per freeze §9) — guaranteed merge conflict; should be a
  cherry-pickable commit.
- P2 `baseline-bridge.ts` default `pythonBin = "python3"` (3.14.2 = wrong per
  freeze); live baselines need `PYTHON_BIN=python3.12`; `.env.example` not
  updated.
- P2 No `baseline-bridge.test.ts` — the real subprocess seam (timeout, env
  allow-list, argv, JSON parse) is untested; all adapter tests inject a fake
  report.
- P2 Graph variant is hard-labeled `live-graph-orchestrator` regardless of
  `PLAN_ENGINE`; under `python-legacy` it would mislabel a legacy-Python plan.
- P3 Web proxy timeout 90s < backend baseline timeout 120s; graph adapter has
  no timeout bound; endpoint `query` param is recorded but ignored by all three
  (baselines read cases-file query; graph uses a deterministic decomposer);
  `SIGN_IN_URL` constant now misnamed (points to `/test-wallets`).

### Commands run (read-only)
| Command | Result |
|---|---|
| `npm run typecheck` (apps/api) | ✓ exit 0 |
| `vitest run src/comparison` (apps/api) | ✓ 44 passed (7 files) |
| `vitest run` (apps/api, full) | ✓ 264 passed / 10 skipped (live-PG) |
| `python3.12 -m unittest tests.test_demo_comparison_baseline_alignment tests.test_person_c_scorer_grounding` | ✓ 13 passed |
| `vitest run components/comparison lib/comparison` (web) | ✓ 12 passed |
| `tsc --noEmit` (web) | ✓ exit 0 |
| `next build` | compiles; prerender fails only on pre-existing Clerk pages (missing `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`); `/test-wallets` is force-dynamic, not in failure set |
| test-double-in-production scan | ✓ none (comments/fixture-paths only) |
| secret scan over diff | ✓ none |
| live graph / chat-crew / single-agent runs | ✗ NOT RUN (no key/DB) |
| browser hero flow | ✗ NOT RUN (no running backend) |

### Input-equivalence result
`PROVEN_EQUIVALENT` at input-construction level (static contract + prompt
tests); runtime equivalence (live DB persona == fixture, live prompts actually
sent) `NOT VERIFIED`.

---

## 2026-06-28 — Person B Review-Fix + Live Verification Attempt

Worktree `../gpFree-comparison`, branch `demo/test-wallet-comparison`, base
`b701fde`. Addressed all six confirmed post-implementation review findings;
attempted Stages 2–6 live verification.

### Tools used
- Cursor agent (Claude) via `/ce-work` with the Person B review-fix prompt.
- `Read`/`Grep`/`Glob`/`Write`/`StrReplace` for implementation.
- `vitest`, `tsc`, `python3.12 unittest`, `next build` for offline validation.
- `git` for status, diff, and focused commits.

### Decisions
1. **Python interpreter (Fix 1):** `PYTHON_BIN` → `python3.12` default; never
   `python3`. Missing interpreter fails clearly.
2. **Engine guard (Fix 2):** `ComparisonDeps.planEngine` optional, fail-closed;
   only `orchestrator` runs the graph slot.
3. **Subprocess tests (Fix 3):** real `execFile` seam via `fake-baseline.mjs`
   (node script), 17 tests covering all 11 required behaviors.
4. **Timeouts (Fix 4):** `timeouts.ts` constants (graph 60s, baselines 120s,
   proxy 135s); graph `Promise.race` bound added.
5. **Canonical query (Fix 5):** endpoint 400 on non-canonical query; web proxy
   no longer forwards `query`.
6. **Route integration (Fix 6):** reverted new `app.ts` edits; documented
   one-line patch in `docs/demo/PERSON_B_ROUTE_INTEGRATION.md`.

### Tests added / updated
| Area | File | Count |
|---|---|---|
| Subprocess bridge seam | `baseline-bridge.test.ts` | 17 new |
| Timeout contract | `timeouts.test.ts` | 3 new |
| Graph timeout | `graph-orchestrator.test.ts` | 1 new |
| Endpoint query + engine | `routes.test.ts` | 5 new |
| Web proxy floor | `lib/comparison/client.test.ts` | 2 new |

### Commands run
| Command | Result |
|---|---|
| `npm run typecheck` (apps/api) | ✓ exit 0 |
| `vitest run src/comparison` (apps/api) | ✓ 70 passed (9 files) |
| `vitest run` (apps/api, full) | ✓ 290 passed / 10 skipped |
| `python3.12 -m unittest tests.test_demo_comparison_baseline_alignment tests.test_person_c_scorer_grounding` | ✓ 13 passed |
| `vitest run` (web, full) | ✓ 206 passed |
| `tsc --noEmit` (web) | ✓ exit 0 |
| `next build` | compiles; prerender fails on pre-existing Clerk pages only |
| secret scan over diff | ✓ none |
| production test-double scan | ✓ none in comparison source |

### Live verification (Stages 2–6) — BLOCKED
| Stage | Status | Blocker |
|---|---|---|
| Env setup (`rewards_comparison`, keys) | ✗ NOT RUN | No `.env` in worktree; `OPENAI_API_KEY`, `DATABASE_URL`, `PGDATABASE` all unset in shell |
| DB seed + wallet verify | ✗ NOT RUN | Postgres not listening on :5432; Docker daemon absent |
| Graph orchestrator live | ✗ NOT RUN | No DB, no `PLAN_ENGINE` env |
| Single-agent live | ✗ NOT RUN | No `OPENAI_API_KEY` |
| Chat-crew live | ✗ NOT RUN | No `OPENAI_API_KEY` |
| Runtime input equivalence (live) | ✗ NOT VERIFIED | Static contract tests only |
| Aggregate endpoint live | ✗ NOT RUN | No running API |
| Browser hero flow | ✗ NOT RUN | No running API/web |
| Partial-failure live | ✗ NOT RUN | No running API |

### Manual review
- Re-read all six review findings against the diff before committing.
- Confirmed `app.ts` reverted to committed state (no new Person-A conflict).
- Confirmed UI already sends only `{ walletId }` (no editable query).

### Deferred work
- Live three-way execution (credentials + `rewards_comparison` DB + running stack).
- Integrator applies `planEngine: deps.planEngine` one-line patch in `app.ts`.
- Replan remains disabled pending Person A `LIVE TYPESCRIPT REPLAN VERIFIED`.

### Verdict
`THREE-WAY LIVE COMPARISON BLOCKED` — all six review fixes shipped and
offline-verified (290 API + 206 web + 13 Python tests green); live execution
remains blocked on credentials/DB/runtime in this worktree.

---

## Entry 017 — Final Integration + Live Demo Verification (2026-06-28)

**Task:** Merge Person A orchestrator-replan + Person B three-way comparison on
`demo/final-integration`, verify live PostgreSQL + live OpenAI + browser hero flow.
**Branch:** `demo/final-integration` (worktree `gpFree`).
**Production code changed:** Yes — simulate-transfer demo route, Test Wallets replan
button, `force-dynamic` root layout, `idempotencyReplayed` on transfer result.

### Integration SHAs

| Item | SHA |
|---|---|
| Starting base (Person A tip before merge) | `ffcbab6` |
| Person A | `9208f5c`, `501df8f`, `6216609`, `ffcbab6` |
| Person B (merge parent) | `37e9079` |
| Integration merge | `2c080f2` |
| Post-merge live wiring (this session) | uncommitted → commit below |

**Conflict resolution:** Only `AI_USAGE.md` (concatenated both lanes). Manual
`app.ts` patch: `planEngine: deps.planEngine` + `replanService: deps.planService`
on comparison routes.

### Tools used
- Cursor agent (Claude) via `/ce-work`.
- Live PostgreSQL 14 (local `.localpg`, DB `rewards_comparison`).
- Live OpenAI (rotated key; user confirmed revocation/rotation).
- Browser MCP (accessibility snapshots + CDP viewport fix).
- `vitest`, `tsc`, `python3.12 unittest`, `next build`, `curl`, `psql`.

### Key decisions
1. **Simulate-transfer wiring:** Person B left the button disabled pending Person A
   replan; after live replan verified, added `POST /demo/simulate-transfer` (Hono +
   Next proxy) calling `transferBalance` for `CANONICAL_GRAPH_USER_ID` with derived
   15k Chase→Hyatt transfer; UI enables after graph comparison succeeds.
2. **`idempotencyReplayed` on `BalanceTransferResult`:** surfaces replay for UI +
   duplicate-click gate without inferring from null job id alone.
3. **`force-dynamic` on root layout:** fixes production build for all real app
   routes under Clerk; residual Next auto-generated `/404`+`/500` prerender quirk
   remains pre-existing.
4. **Orchestrator env:** Python write bridge needs `PGHOST`/`PGPORT`/`PGUSER`/
   `PGPASSWORD`/`PGDATABASE` (not just `DATABASE_URL`) — documented in runbook.

### Validation totals

| Check | Result |
|---|---|
| API typecheck | ✓ |
| Web typecheck | ✓ (after faithful `npm ci` removed stray `@types/pg`) |
| API suite (serial) | ✓ 310 passed |
| Web suite | ✓ 206 passed |
| Python 3.12 (clean env) | ✓ 230 passed / 10 live-skipped / 0 fail |
| Comparison + simulate tests | ✓ 14 route + 5 component new |
| Live graph / single / chat seams | ✓ |
| Runtime equivalence | ✓ `RUNTIME INPUTS PROVEN EQUIVALENT` |
| Aggregate endpoint + partial failure | ✓ (unit test + live) |
| Live replan + duplicate replay (API) | ✓ |
| Browser hero flow | ✓ landing → facts → compare → simulate → rev2 → replay |
| Production build | **PARTIAL** — 7/7 real routes; Next infra `/404`+`/500` only |
| Secret scan | ✓ no literals in tracked files; `.env` gitignored |

### Browser evidence (live)
- Canonical facts visible: Chase 180k, Hyatt 30k, United 30k, Ginza 45k, Chase→Hyatt 1:1.
- Three cards after comparison (graph transfer step rev1; chat 9k+ tokens; single ~2.2k tokens).
- Simulate: balances → Chase 165k / Hyatt 45k; panel "Revision 2 is now current"; transfer step removed.
- Duplicate click: "Idempotent replay detected — revision 2 remains current"; balances unchanged.

### Exact demo runbook
```bash
# 1. Postgres + seed
#    DB: rewards_comparison  user/pass: rewards/rewards  (PG14+ compatible)
python3.12 scripts/ensure_schema_seed.py  # with DATABASE_URL set

# 2. API (apps/api) — required env NAMES (set values locally, never commit):
#    DATABASE_URL, PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE=rewards_comparison
#    PLAN_ENGINE=orchestrator, AUTH_DEV_USER_ID, RUN_LIVE_POSTGRES_TESTS=1
#    PYTHON_BIN=python3.12, OPENAI_API_KEY, CORS_ORIGIN=http://localhost:3000
npm run dev   # port 8787

# 3. Web (repo root) — NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, API_BASE_URL
npm run dev   # port 3000

# 4. Browser: http://localhost:3000/ → Start Optimizing → Test Wallets
#    Run comparison → Simulate completed transfer → Repeat (idempotent replay)

# 5. Reset between full demos:
curl -X POST http://localhost:8787/demo/reset
```

### Backup recording status
Not performed in this session (no screen capture tooling invoked).

### Verdict
`FINAL LIVE DEMO VERIFIED` — merged stack runs live against PostgreSQL +
OpenAI; browser hero flow including simulate transfer and idempotent replay
succeeded. Residual: production build `/404`+`/500` prerender (pre-existing Next
infra); PG16-only Python artifact tests skip on PG14; demo runbook requires full
`PG*` env set for orchestrator subprocesses.

