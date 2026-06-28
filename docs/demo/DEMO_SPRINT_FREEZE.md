# Demo Sprint Freeze — Joint Hour 0–1 Baseline

> **Purpose:** Lock a shared baseline so two contributors can split immediately
> without colliding. This is a coordination contract, not an implementation.
> Scope rules for this freeze: do **not** build Test Wallets UI, do **not** fix
> orchestrator replan, do **not** build the full comparison endpoint, do **not**
> refactor agents. (See companion runbook [`layer4-cut-contingency.md`](layer4-cut-contingency.md).)

| Field | Value |
|---|---|
| Freeze timestamp | 2026-06-28 |
| Repository root | `gpFree/` (nested git repo; outer `Capstone/` is **not** a repo) |
| Starting branch | `main` |
| **Starting SHA (both lanes branch from this)** | **`6c388cb`** (`6c388cbd6898e21eb88fa838c8ec9210a9cfa842`) |
| `origin/main` | `6c388cb` (in sync, 0 ahead / 0 behind) |
| Working tree | clean (no uncommitted repo files were present or created) |
| Verdict | **JOINT FREEZE COMPLETE — DATA ALIGNMENT REQUIRED** |

---

## 1. Repository safety report

| Item | Result |
|---|---|
| Repository root | `/…/Capstone/gpFree` |
| Current branch | `main` |
| HEAD SHA | `6c388cb` |
| `origin/main` SHA | `6c388cb` |
| Ahead/behind | 0 / 0 |
| Working tree | clean |
| Uncommitted files | none |
| Stashes | 5 pre-existing (`stash@{0..4}`) — **do not touch**; unrelated to this freeze |
| `.env` ignored | yes (`.gitignore:23` covers `.env` and `apps/api/.env`; both confirmed ignored) |
| Node version | v23.11.0 (no `engines`/`.nvmrc` pin in repo) |
| Python executable | **`python3.12`** (3.12.13) — CI-expected. `python3` is 3.14.2 and is the WRONG interpreter here |
| Expected Python | 3.12 (`.github/workflows/*.yml`) |
| PostgreSQL | reachable (`rewards_test`, server PG 16.13) |
| `OPENAI_API_KEY` | present in `.env` (value never printed) |
| `SINGLE_AGENT_BASELINE_API_KEY` | absent (baselines fall back to `OPENAI_API_KEY`) |
| Graph DB vars (`DATABASE_URL`, `PG*`) | present |
| `PLAN_ENGINE` | `python-legacy` (orchestrator is explicit opt-in via `PLAN_ENGINE=orchestrator`) |
| Secrets | none printed/stored; only presence/absence reported |

**Working-tree safety:** tree is clean, so there is no pre-existing in-progress work to protect inside tracked files. Both contributors must branch from `6c388cb`.

**⚠️ Live-DB caution (shared resource):** the `rewards_test` database is shared and was found re-seeded by a parallel process with a generic schema-smoke seed (`clerk_rcg12`, programs `Ultimate Rewards/Airline Mid/Hotel Dest`). The canonical demo persona was reloaded **non-destructively** for this freeze via `python3.12 scripts/load_seed.py fixtures/demo-seed.json --include-demo-persona` (idempotent `ON CONFLICT … DO UPDATE`; the smoke seed coexists). Treat DB state as volatile — re-seed before any live run.

---

## 2. Canonical Transfer-Required wallet

**Source of truth:** `fixtures/demo-seed.json` (`fixture_id: demo-seed-v1`), confirmed live in PostgreSQL for user `00000000-0000-0000-0000-00000000a001` (`clerk_hero_demo`).

```jsonc
// CanonicalDemoWallet (field names mapped to repo conventions)
{
  "walletId": "transfer-required",
  "version": "demo-seed-v1",
  "personaIdOrFixtureId": "00000000-0000-0000-0000-00000000a001",   // clerk_hero_demo
  "displayName": "Hero Demo — Transfer Required (Tokyo Hyatt)",
  "description": "Hyatt balance cannot fund the Ginza award directly; a 1:1 Chase→Hyatt transfer closes the gap.",

  "cards": [
    { "cardId": "card:chase_sapphire_reserve",   "cardName": "Chase Sapphire Reserve",   "issuer": "Chase", "programId": "…b001", "programName": "Chase Ultimate Rewards" },
    { "cardId": "card:chase_sapphire_preferred", "cardName": "Chase Sapphire Preferred", "issuer": "Chase", "programId": "…b001", "programName": "Chase Ultimate Rewards" },
    { "cardId": "card:chase_freedom_unlimited",  "cardName": "Chase Freedom Unlimited",  "issuer": "Chase", "programId": "…b001", "programName": "Chase Ultimate Rewards" },
    { "cardId": "card:world_of_hyatt",           "cardName": "World of Hyatt Credit Card","issuer": "Chase", "programId": "…b002", "programName": "World of Hyatt" },
    { "cardId": "card:united_explorer",          "cardName": "United Explorer Card",      "issuer": "Chase", "programId": "…b003", "programName": "United MileagePlus" }
  ],

  "balances": [
    { "programId": "…b001", "programName": "Chase Ultimate Rewards", "points": 180000, "version": 1 },
    { "programId": "…b002", "programName": "World of Hyatt",         "points": 30000,  "version": 1 },
    { "programId": "…b003", "programName": "United MileagePlus",     "points": 30000,  "version": 1 }
  ],

  "transferRelationships": [
    { "sourceProgramId": "…b001", "destinationProgramId": "…b002", "ratio": 1.0 },  // Chase → Hyatt  (10000 bps)
    { "sourceProgramId": "…b001", "destinationProgramId": "…b003", "ratio": 1.0 }   // Chase → United (10000 bps)
  ],

  "awardOptions": [
    { "awardId": "…f001", "displayName": "Demo Hyatt Ginza 3-night Tokyo award", "programId": "…b002", "pointsRequired": 45000, "availabilityStatus": "available" },
    { "awardId": "…f002", "displayName": "United MileagePlus Tokyo saver award", "programId": "…b003", "pointsRequired": 60000, "availabilityStatus": "available" }
  ],

  "goal": { "destination": "Tokyo", "category": "hotel_award", "nights": 3 }
}
// `…b001` = 00000000-0000-0000-0000-00000000b001, etc. (full UUIDs in fixtures/demo-seed.json)
```

### Behavioral invariant — numerically PROVEN (live DB)

Selected destination program = **World of Hyatt (`…b002`)**; selected award = **Ginza (`…f001`), cost 45,000**.

```
destination (Hyatt) balance          = 30,000
selected award cost (Ginza)          = 45,000
  → 30,000 < 45,000                   ✅ cannot fund directly

transferable source (Chase UR)       = 180,000  @ ratio 1.0 → Hyatt
  30,000 + 15,000 (transfer)         = 45,000
  → 30,000 + 15,000 ≥ 45,000          ✅ can fund after a supported transfer
```

**Expected transfer shortfall = 15,000 points** (transfer 15,000 Chase UR → Hyatt at 1:1).
(United alt is intentionally infeasible-direct too: 30,000 < 60,000.)

**Private gold (NOT supplied to agents, NOT in the public wallet object):** the expected winning plan is *transfer 15,000 Chase→Hyatt, then redeem Ginza f001*. Keep this in the evaluator/gold side only.

---

## 3. Canonical query (frozen, verbatim)

```
What is the best way to use my points for a three-night hotel stay in Tokyo?
```

Architecture-neutral on purpose (does not name "Hyatt") so each architecture must *discover* the answer, keeping the grounding comparison fair.

**Adapter note (alignment work):** the existing live orchestrator test uses a different Hyatt-specific string (`"Book a 3-night Hyatt award stay in Tokyo in October using my points."`) and the benchmark gold case `mvp_001` uses `"What is the best Hyatt redemption for a 3-night Tokyo trip?"`. Person B's adapters must pass the **canonical** string above verbatim to all three architectures.

---

## 4. Three verified execution-seam summaries (live, SHA `6c388cb`)

All three were executed live — not asserted from prior reports.

### 4a. Graph orchestrator — initial plan (live PostgreSQL)
- **Command:** `RUN_LIVE_POSTGRES_TESTS=1 PLAN_ENGINE=orchestrator DATABASE_URL=… PG*=… npx vitest run tests/plans/orchestrator-service.test.ts -t "Phase 5"` (apps/api). Production entry = `composeOrchestratorPlanService({pool, env}) → OrchestratorPlanService.createPlan` (`apps/api/src/plans/orchestrator-service.ts:85`); HTTP = `POST /plans` (`routes.ts:32`).
- **Result:** PASS. planId `c28ed5f5-…`, lineage `73e4b2a8-…`, **revision 1 / current**, specialists **wallet_agent → redemption_agent** (both `completed`), graph_mutations 4, state_dependencies 1, steps 1. Latency ≈ 10.4 s (createPlan run). Native output type = `PlanView`. **No legacy fallback** (createPlan throws `OrchestratorPlanError` on failure; never calls the read delegate for generation).
- State source = live `demo-seed-v1` persona (Chase 180k / Hyatt 30k / United 30k).

### 4b. Single-agent baseline (live OpenAI)
- **Command:** `OPENAI_API_KEY=… python3.12 -m benchmark.single_agent_baseline --limit 1 --pretty` (real `OpenAIChatCompletionsClient`, no fake on CLI path).
- **Result:** exit 0, ≈ 10.9 s, **1 model call**, model default `gpt-5.5`, tokens 2,050. Selected award `award:demo_hyatt_ginza:tokyo:3n` (accuracy_correct = true). Native output = `baseline_single_agent` dict (`status, chosen_award_slug, fallback, unsupported_reason, ranked_awards, steps`).
- Grounding flag `award_not_in_tool_result` → see §Grounding audit (NOT a hallucination).
- State source = `person-c-mvp-tokyo-hyatt-v1` fixture (Chase 75k only; **no Hyatt/United**).

### 4c. Chat-crew / free-text multi-agent baseline (live OpenAI)
- **Command:** `OPENAI_API_KEY=… python3.12 -m benchmark.free_text_multiagent_baseline --limit 1 --pretty` (real client; falls back `FREE_TEXT_MULTIAGENT_BASELINE_API_KEY` → `OPENAI_API_KEY`).
- **Result:** exit 0, ≈ 22.4 s, **4 model calls** in role sequence `wallet_agent → earning_agent → redemption_agent → coordinator`, model default `gpt-5.5`, tokens 8,367. Selected `award:demo_hyatt_ginza:tokyo:3n` (accuracy_correct = true). Native output = `baseline_free_text_multiagent` dict with `{agent_transcript, final_plan}`.
- Grounding flag `award_not_in_tool_result` → same artifact as 4b.
- State source = `person-c-mvp-tokyo-hyatt-v1` fixture (Chase 75k only).

### Grounding finding audit (Phase 5) — classification: `EVALUATOR_BOUNDARY_MISMATCH`
Both baselines were flagged `award_not_in_tool_result`. Root cause traced through facts → prompt → raw output → scorer:
- The **only** offending slug is `balance:user_mvp_demo:chase_ur`, emitted in each ranked award's `candidate_fact_slugs`.
- That slug **is supplied** to the model in the prompt (`_user_prompt` → `seeded_context.balances`, `single_agent_baseline.py:308-315`).
- But the scorer's `_fixture_fact_slugs` (`person_c_scorer.py:212-217`) builds its valid set from `transfer_paths + award_options + hotels + cash_quote_slug` **only — it omits `balances`**, and the misleadingly-named `award_not_in_tool_result` code (`person_c_scorer.py:186-188`) fires on *any* unrecognized `candidate_fact_slug`.
- **Conclusion:** the model cited a real, seeded balance fact; the flag is a scorer-vocabulary false positive. **Do not call this a hallucination.** (Fix belongs to Person B's evaluator lane: include balance slugs in the valid set, or rename/split the issue code.)

---

## 5. Native output-shape inventory

| Architecture | Native output (source of truth) |
|---|---|
| Graph orchestrator | `PlanView` — `apps/api/src/plans/types.ts:57` (`{planId, planLineageId, revisionNumber, status, query, summary, steps[], graph{nodes,edges}}`); orchestrator core `PlanResult` `apps/api/src/orchestrator/contracts.ts:10` |
| Single-agent | dict `plan_type:"baseline_single_agent"`, `raw_output={status, chosen_award_slug, fallback, unsupported_reason, ranked_awards[], steps[]}` — `benchmark/single_agent_baseline.py:363` |
| Chat-crew | dict `plan_type:"baseline_free_text_multiagent"`, `raw_output={agent_transcript[], final_plan{…same 6 keys…}}` — `benchmark/free_text_multiagent_baseline.py:166` |
| Frontend consumer | `ApiPlan` (`lib/api/types.ts:45`) → adapted to `lib/plan/types.ts:117` `PlanResult` (hand-mirrored superset) |
| Comparison report | `benchmark/architecture_comparison.py:19` `build_architecture_comparison`; metrics `benchmark/metric_summary.py:66` |

There is **no shared TS workspace** (`package.json` has no `workspaces`; no `packages/`/`shared/`). The two TS surfaces (`apps/api/src` Hono API, root `app|lib|components` Next.js) deliberately duplicate the Plan shape.

---

## 6. Frozen normalized comparison types

No safe shared code location exists (adding a workspace = architectural change, out of scope for this freeze). **The contract is frozen here**; Person B creates the code-level type immediately after the split (proposed home: `apps/api/src/comparison/types.ts` mirrored to `lib/comparison/types.ts`, following the existing hand-mirrored-superset convention; check `docs/adr/0007-contract-ownership-codegen.md` first).

```typescript
type ArchitectureVariant = "live-graph-orchestrator" | "chat-crew" | "single-agent";
type ArchitectureRunStatus = "not_started" | "running" | "succeeded" | "failed" | "timed_out";

interface NormalizedPlanStep {
  order: number;
  actionType: "transfer" | "redeem" | "hold" | "fallback" | "other";
  title: string;
  sourceProgramId?: string;
  destinationProgramId?: string;
  points?: number;
  awardId?: string;
  reasoningSummary?: string;          // user-facing summary ONLY — never chain-of-thought
}

interface NormalizedPlan {
  summary: string;
  goalSatisfied: boolean;
  transferRequired: boolean;
  transferAmount?: number;
  selectedProgramId?: string;
  selectedAwardId?: string;
  redemptionPoints?: number;
  steps: NormalizedPlanStep[];
}

interface PlanEvaluation {              // correctness and grounding are SEPARATE fields
  structurallyValid: boolean;
  goalSatisfied: boolean;
  affordable: boolean;
  supportedTransferRoute: boolean;
  allAwardReferencesGrounded: boolean; // independent of recommendation correctness
  negativeBalanceCreated: boolean;
  unnecessaryTransfer: boolean;
  issues: Array<{ code: string; message: string; severity: "error" | "warning" }>;
}

interface ArchitectureMetrics {
  latencyMs: number;
  model?: string;
  modelCalls?: number;
  inputTokens?: number;                // undefined when unknown — NEVER fabricate 0
  outputTokens?: number;
  totalTokens?: number;
}

interface ArchitectureEvidence {       // architecture-specific, all optional
  agentTypes?: string[];
  handoffCount?: number;
  dependencyCount?: number;
  agentRunCount?: number;
  revisionNumber?: number;
  planId?: string;
  lineageId?: string;
  citedAwardIds?: string[];
  availableAwardIds?: string[];
}

interface ArchitectureComparisonResult {
  variant: ArchitectureVariant;
  status: ArchitectureRunStatus;
  walletId: string;                    // "transfer-required"
  walletVersion: string;              // "demo-seed-v1"
  query: string;                       // the canonical query, verbatim
  plan?: NormalizedPlan;
  evaluation?: PlanEvaluation;
  metrics: ArchitectureMetrics;
  evidence?: ArchitectureEvidence;
  error?: { category: string; message: string };
}
```

**Contract rules (frozen):** correctness ≠ grounding (separate fields); a correct award with unsupported provenance is representable (`goalSatisfied:true` + `allAwardReferencesGrounded:false`); missing tokens stay `undefined`; evidence optional; no chain-of-thought in the normalized plan; the evaluator is architecture-blind and never ranks on prose.

---

## 7. Input-equivalence matrix (Phase 7)

| Input property | Graph orchestrator | Chat crew | Single agent | Aligned? |
|---|---|---|---|---|
| Wallet ID | `transfer-required` (demo-seed-v1) | person-c-mvp fixture | person-c-mvp fixture | ❌ |
| Persona/fixture | `demo-seed-v1` (a001) | `person-c-mvp-tokyo-hyatt-v1` | `person-c-mvp-tokyo-hyatt-v1` | ❌ |
| Query | `Book a 3-night Hyatt…October…` (test) | gold `What is the best Hyatt redemption…` | gold `What is the best Hyatt redemption…` | ❌ (none = canonical yet) |
| Cards | 5 (CSR/CSP/CFU/Hyatt/United) | none in fixture | none in fixture | ❌ |
| Chase balance | 180,000 | 75,000 | 75,000 | ❌ |
| Hyatt balance | 30,000 | **none** | **none** | ❌ |
| Other balances | United 30,000 | none | none | ❌ |
| Transfer routes | Chase→Hyatt, Chase→United (1:1) | Chase→Hyatt (1:1) | Chase→Hyatt (1:1) | ⚠️ partial |
| Award inventory | Ginza 45k, United 60k | Ginza 45k/Shinjuku 30k/Ueno 24k | same 3 | ❌ |
| Cash values | cpp_basis_points (DB) | cash_quote per award | cash_quote per award | ❌ |
| Tool outputs | real PG snapshot | seeded JSON in prompt | seeded JSON in prompt | ❌ |

**Classification: `SEPARATE_DATA_WORLDS`.** The graph orchestrator reads canonical PostgreSQL (`demo-seed-v1`); both LLM baselines read the `person-c-mvp` JSON fixture with a different balance set and no Hyatt balance. The freeze ends here intentionally — alignment is Person B's first adapter task (see §10/§11). Until aligned, **no fair head-to-head comparison may be claimed.**

---

## 8. Deterministic evaluation contract (Phase 9)

**Hard validity gates (any → invalid):** references an award absent from supplied facts; uses an unsupported transfer route; spends more than available; creates a negative balance; claims goal satisfied while unmet; malformed/contradictory steps.

**Ranking among valid plans (lexicographic, no weighted score in the freeze):**
1. Goal satisfaction → 2. Feasibility → 3. Highest supported redemption value (when comparable) → 4. Avoid unnecessary transfers → 5. Fewer executable steps → 6. Preserve flexible points (tie-break).

**Evaluator I/O:** input = `{NormalizedPlan, CanonicalDemoWallet facts, canonical query}`; output = `PlanEvaluation` (§6). Architecture-blind; correctness and grounding scored independently.

**Reuse vs adapt:** `benchmark/person_c_scorer.py` (`accuracy_correct`, `hallucination_issues`, `rate`) is the reusable core. **Required adaptation:** fix the balance-slug omission in `_fixture_fact_slugs` (§4 grounding audit) before grounding numbers are trustworthy; map the scorer's dict issues into the `PlanEvaluation.issues[]` shape.

---

## 9. Two-person ownership map (Phase 10)

### Person A — Orchestrator replan lane
Owns: `apps/api/src/plans/orchestrator-service.ts`, `apps/api/src/orchestrator/**`, `apps/api/src/agents/**` (replan-relevant only), plan-step promotion (`proposed → current`), dependency invalidation, replan lifecycle, reset-contamination fixes (idempotency_records + agent_runs not cleared by `resetDemo`), `apps/api/tests/plans/**` replan tests, replan docs.
Behavioral target: `rev1 current → relevant balance mutation → dependency invalidated → rev1 stale → TS orchestrator re-enters → new Wallet AgentRun → new Redemption AgentRun → rev2 current → rev1 superseded`.

### Person B — Comparison & Test Wallets lane
Owns: canonical wallet exposure, chat-crew adapter, single-agent adapter, graph initial-plan adapter, architecture-comparison endpoint, normalized-evaluation integration (+ the `_fixture_fact_slugs` evaluator fix), Test Wallets page, three result cards, loading/failure states, web tests (`*.test.tsx`), data-world alignment.

### Shared files — single-writer rule

| File or path | Owner | Other contributor's integration mechanism |
|---|---|---|
| Shared comparison types (`apps/api/src/comparison/*`, `lib/comparison/*` — new) | **Person B** | Person A requests fields via PR comment / interface note |
| API route registration (`apps/api/src/app.ts`, `apps/api/src/plans/routes.ts`) | **Person A** | Person B supplies a small cherry-pickable commit adding the comparison route |
| Environment example (`.env.example`) | **Person B** | Person A appends via patch request |
| Fixture definitions (`fixtures/**`) | **Person B** | Person A requests changes via note (no concurrent edits) |
| `AI_USAGE.md` | append-only, both | each appends a dated `###` section; never edit the other's section |
| Status docs (`STATUS.md`, `tracking/`, `context/progress-tracker.md`) | **Lead (Raq)** | excluded from feature PRs per `AGENTS.md` |

---

## 10. Branch & integration strategy (Phase 11)

- **Starting SHA:** `6c388cb` (both branches start here; do **not** create/switch branches over the 5 pre-existing stashes — they are unrelated and untouched).
- **Branches:** `demo/orchestrator-replan` (Person A), `demo/test-wallet-comparison` (Person B).
- **Order of operations:**
  1. **Freeze contract commit** — Person B lands the code-level `ArchitectureComparisonResult` type + evaluator fix in a small first commit on `demo/test-wallet-comparison` (or a shared `demo/contract-freeze` cut from `6c388cb`).
  2. Both branches start from that commit.
  3. Person B proceeds against the frozen contract (adapters → endpoint → UI behind the contract).
  4. Person A integrates replan **behind the same `POST /plans` / comparison contract** (no public shape change).
  5. Replan UI is enabled **only after** a live replan verification passes (`rev2 current`, fresh AgentRuns).
- **Merge order:** contract commit → Person B comparison/UI → Person A replan. **Integrator/final conflict owner: Lead (Raq)** for shared route registration and contract files.
- Commit boundaries: single-responsibility, conventional-commits, AI co-author trailer (per repo `commits.md`).

---

## 11. Concrete blockers (Phase 10)

| Blocker | Class | Detail |
|---|---|---|
| Data worlds differ (graph=demo-seed-v1 vs baselines=person-c-mvp) | `SMALL_ADAPTER` | Point baselines at a fixture mirroring the canonical wallet, OR add an adapter that feeds the canonical wallet to the baselines + canonical query verbatim. |
| Canonical query not yet wired to any architecture | `SMALL_ADAPTER` | Override the gold/test query strings with the frozen canonical query in all three adapters. |
| Evaluator grounding false-positive (balance slugs) | `SMALL_ADAPTER` | Add `balances[].slug` to `_fixture_fact_slugs` (or split the issue code) before reporting grounding. |
| Shared comparison type has no code home | `SMALL_ADAPTER` | Person B creates `comparison/types.ts` post-split (no workspace change). |
| Orchestrator replan blocked (steps stay `proposed`; invalidation needs `current`) | `MEDIUM_INTEGRATION` | Person A's lane; out of scope for this freeze. |
| Live DB volatility / shared re-seeding | `EXTERNAL_BLOCKER` | Re-seed `demo-seed-v1` before each live run; isolate per-DB if collisions persist. |
| OpenAI dependency for baselines | `NONE` | `OPENAI_API_KEY` present; both baselines ran live. |

---

## 12. Presentation-safe claims

**May state (proven by live runs at `6c388cb`):**
- The live graph orchestrator initial-plan flow runs end-to-end on real PostgreSQL: `POST /plans`/`createPlan` → user-scoped snapshot → Wallet → Redemption → controlled Python writes → revision-1 `current` Plan + AgentRuns + dependency + projection. No silent legacy fallback.
- Both LLM baselines execute live against OpenAI (single-agent: 1 call/2,050 tok/~11s; chat-crew: 4 roles/8,367 tok/~22s) and both selected the expected best-value award (Ginza).
- The canonical transfer-required wallet is numerically proven from live DB (shortfall 15,000; transfer 15k Chase→Hyatt makes Ginza affordable).

**May NOT state:**
- That the three architectures were compared on equal inputs — they are currently `SEPARATE_DATA_WORLDS`.
- That the baselines "hallucinated" — the `award_not_in_tool_result` flag is an `EVALUATOR_BOUNDARY_MISMATCH` (balance slug omitted from the scorer vocabulary), not a model fabrication.
- Anything about orchestrator **replan** working — it is blocked (separate lane) and was not run in this freeze.
- Any hosted/deployed result — not tested (`API_BASE_URL` is localhost).

---

## 13. Immediate next command — Person A (replan lane)
```bash
cd gpFree && git switch -c demo/orchestrator-replan 6c388cb
# First task: make the orchestrator promote plan_steps proposed→current when the plan
# transitions to current, so mark_direct_plan_dependents_stale (schema.sql:672, requires
# ps.status='current') can fire. Add a FAILING live replan test first:
#   reset → orchestrator createPlan (rev1) → transferBalance(Chase→Hyatt 15000)
#   → assert replan_job created, rev1 superseded, rev2 current, fresh wallet+redemption AgentRuns.
```

## 14. Immediate next command — Person B (comparison/UI lane)
```bash
cd gpFree && git switch -c demo/test-wallet-comparison 6c388cb
# First task: land the frozen ArchitectureComparisonResult type (apps/api/src/comparison/types.ts
# + lib/comparison/types.ts) with a compile-time test, then build the data-world adapter so all
# three architectures receive the canonical wallet + canonical query verbatim. Also fix
# _fixture_fact_slugs to include balance slugs. Do NOT build the UI cards until the contract compiles.
```
