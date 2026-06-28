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
