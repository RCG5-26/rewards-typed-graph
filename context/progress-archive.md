# Progress Archive — Rewards Agent

> Deep historical record. The agent reads [`progress-tracker.md`](progress-tracker.md) by default and opens this only when it needs history older than the current phase. Newest first. When the tracker's "Recently completed" grows past the current phase, move the older entries here.

---

## 2026-06-20/21 — Linear reconciliation + planning docs

- Removed Ruijing from the board entirely. Labels were already clear; cleaned the remaining mentions in RCG-39/40/41/42 descriptions. Team is four: Alan (Graph), Val (Frontend), Michael (Redemption/Eval), Raq (Orchestrator/lead).
- RCG-35 (single-agent baseline) reassigned to Raq, per ADR 0003.
- RCG-40 (eval harness) re-homed from the Layer 4 stretch milestone to **M4 — Benchmark + Baselines**; retitled "benchmark runner across architectures"; set to Raq as DRI; `Layer 4 (stretch)` and `owner: Person C` labels dropped.
- RCG-14 updated to name the `graph_mutations` table (audit + SSE replay).
- Marked Done: RCG-5 (schema lock), RCG-6 (draft schema spec).
- New tickets:
  - Eval instrumentation sub-tasks of RCG-40: RCG-52 (graph lane), RCG-53 (orchestrator/agents), RCG-54 (plan-correctness scoring).
  - RCG-55 — pre-commit benchmark win thresholds (all four sign off); blocks RCG-37.
  - v3.1 closeout infra: RCG-56 plan-lineage/revision model, RCG-57 `replan_jobs` durable queue, RCG-58 `idempotency_records`, RCG-59 per-user advisory lock + SSE, RCG-60 hosted runtime topology, RCG-61 JSON Schema contracts + codegen.
  - Board now spans RCG-5–61.
- Docs: `project-overview.md` written in full, then condensed to the repo template (~1.2k words). `STATUS.md`, `README.md`, and the `tracking/` files were updated to real names earlier in the sprint.

## 2026-06-18 — Schema lock (v3.1) + architecture closeout

- ADR 0001 **Accepted** (all four signed). `schema-final.md` v3.1 is the canonical spec; supersedes `schema-v2.md`.
- Architecture closeout D019–D027 (see `context/architecture-context.md`): plan-lineage + revision model and a `plans.status` lifecycle (no `is_current` / `is_stale` booleans); `graph_mutations`, `replan_jobs`, `idempotency_records` infrastructure tables; per-user `pg_advisory_xact_lock` + SSE ordering; hosted managed-Postgres runtime with the eval harness never deployed; JSON Schema contracts + shared-type codegen.
- ADRs: 0004 runtime topology, 0005 plan lineage / replan_jobs, 0006–0008 (see `docs/adr/`); 0007 contract ownership/codegen, 0008 per-user serialization + SSE.
- Unified transfers locked: transfers are `transfers_to` edges between two `reward_programs`; no `TransferPartner` node. `Merchant` / `Transaction` dropped from the MVP.

## 2026-06-17 — Sprint kickoff, repo + board scaffold

- Repo (`gpFree`) scaffolded: `README.md`, `STATUS.md`, the `context/` set, `tracking/` per-person files, and `planning-brief.pdf`.
- Schema path: schema-v2 (Alan's draft) → staff review (resolutions B1–B5, I1–I5) → schema-final.
- Linear project **RCG** created: 47 tickets (RCG-5–51), lane labels (Graph/Persistence, Orchestrator/Agents, Redemption/Eval, Frontend/Demo), 6 milestones (M1 schema lock → M6 polish), schema-lock as the blocking issue on downstream work.
- ADR 0002 — keep the research apparatus: the 30-query benchmark, single-agent and free-text (CrewAI-style) baselines, the eval harness, and the five metrics.
- ADR 0003 — team = 4 (Ruijing out); eval harness is a whole-team contribution with Raq as DRI; baselines split (single-agent → Raq, CrewAI → Michael); Layer 4 cut-by-default with a Day 10 go/no-go.
