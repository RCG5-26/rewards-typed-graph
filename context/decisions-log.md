# Decisions Log — Rewards Agent

> **Master index** for all project decisions. Do not duplicate full ADR text here.
>
> - **Formal / expensive-to-reverse** → [`docs/adr/`](../docs/adr/) (one file per decision, PR-reviewed)
> - **Workshop / session** → one-line summary below + detail in [`architecture-context.md`](architecture-context.md) or [`schema-final.md`](../docs/architecture/schema-final.md)

**Rule:** add a row to the index first. Create a new ADR when the decision is hard to reverse, needs sign-off, or changes schema scope.

---

## How to log a decision

1. Add a row to the **Master index** (newest at top of its group).
2. If the decision is durable and costly to undo → create `docs/adr/000N-short-title.md` and link it from the index.
3. If the decision is implementation detail → put detail in `architecture-context.md` (or schema spec) and point the index there.
4. If a decision is replaced → set status to **Superseded** and link the replacement ID or ADR. Do not delete rows.

---

## Master index

### Formal ADRs

| ID                                                         | Date       | Decision                                                               | Status   | Canonical source |
| ---------------------------------------------------------- | ---------- | ---------------------------------------------------------------------- | -------- | ---------------- |
| [ADR 0001](../docs/adr/0001-schema-lock.md)                | 2026-06-18 | Schema lock (table-per-type, OCC, v3.1 closeout)                       | Accepted | ADR file         |
| [ADR 0002](../docs/adr/0002-mvp-scope-trim.md)             | 2026-06-17 | Keep research apparatus (benchmark, baselines, eval harness)           | Accepted | ADR file         |
| [ADR 0003](../docs/adr/0003-team-four-eval-ownership.md)   | 2026-06-17 | Four-person team; eval DRI; Layer 4 cut-by-default                     | Accepted | ADR file         |
| [ADR 0004](../docs/adr/0004-runtime-topology.md)           | 2026-06-18 | Runtime topology (compose local, managed PG hosted, eval not deployed) | Accepted | ADR file         |
| [ADR 0005](../docs/adr/0005-plan-lineage-replan-jobs.md)   | 2026-06-18 | Plan lineage + lifecycle + replan jobs                                 | Accepted | ADR file         |
| [ADR 0006](../docs/adr/0006-clerk-identity-only.md)        | 2026-06-18 | Clerk identity-only scope                                              | Accepted | ADR file         |
| [ADR 0007](../docs/adr/0007-contract-ownership-codegen.md) | 2026-06-18 | Contract ownership + codegen + subprocess contract                     | Accepted | ADR file         |
| [ADR 0008](../docs/adr/0008-per-user-serialization-sse.md) | 2026-06-18 | Per-user write serialization + SSE                                     | Accepted | ADR file         |

### ~~Planned ADRs~~ _(promoted 2026-06-18 — see Formal ADRs above)_

### Session decisions (D-series)

| ID   | Date       | Decision                                                                                                                           | Status                  | Canonical source                                                                                                               |
| ---- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| D028 | 2026-06-22 | GPFree landing conforms to the Malleable UI design system (tokens only — light/iris, SF Pro/Fira Code; no hardcoded hex/px/easing) | Accepted                | [design-context.md](design-context.md), [design-system/README.md](../design-system/README.md), `components/gpfree/`            |
| D027 | 2026-06-18 | schema-final v3.1 spec + Phase A DDL authored                                                                                      | Accepted                | [schema-final.md v3.1](../docs/architecture/schema-final.md), [ADR 0001](../docs/adr/0001-schema-lock.md), `schema/schema.sql` |
| D026 | 2026-06-17 | Python subprocess contract (JSON I/O, no DB creds, configured timeout/size)                                                        | Accepted                | [ADR 0007](../docs/adr/0007-contract-ownership-codegen.md)                                                                     |
| D025 | 2026-06-17 | `graph_mutations` user-scoped for MVP                                                                                              | Accepted                | [ADR 0008](../docs/adr/0008-per-user-serialization-sse.md)                                                                     |
| D024 | 2026-06-17 | Per-user advisory lock; SSE order within user stream only                                                                          | Accepted                | [ADR 0008](../docs/adr/0008-per-user-serialization-sse.md)                                                                     |
| D023 | 2026-06-17 | Local Postgres container; hosted managed PG; eval not deployed                                                                     | Accepted                | [ADR 0004](../docs/adr/0004-runtime-topology.md)                                                                               |
| D022 | 2026-06-17 | Scoped idempotency with `request_hash`                                                                                             | Accepted                | [schema-final.md](../docs/architecture/schema-final.md) §5.3                                                                   |
| D021 | 2026-06-17 | `replan_jobs` lease + atomic promotion                                                                                             | Accepted                | [ADR 0005](../docs/adr/0005-plan-lineage-replan-jobs.md)                                                                       |
| D020 | 2026-06-17 | Plan/step status lifecycle (no `is_current`, no `is_stale`)                                                                        | Accepted                | [ADR 0005](../docs/adr/0005-plan-lineage-replan-jobs.md)                                                                       |
| D019 | 2026-06-17 | `plan_lineage_id`; one `current` revision per lineage                                                                              | Accepted                | [ADR 0005](../docs/adr/0005-plan-lineage-replan-jobs.md)                                                                       |
| D018 | 2026-06-17 | Eval CLI local/CI only; ephemeral DB; baselines write minimal rows                                                                 | Accepted                | [ADR 0002](../docs/adr/0002-mvp-scope-trim.md), [architecture-context.md](architecture-context.md)                             |
| D017 | 2026-06-17 | `graph_mutations` as SSE replay log (not work queue)                                                                               | Accepted                | [ADR 0008](../docs/adr/0008-per-user-serialization-sse.md)                                                                     |
| D016 | 2026-06-17 | Clerk identity-only; per-user reset; no orgs                                                                                       | Accepted                | [ADR 0006](../docs/adr/0006-clerk-identity-only.md)                                                                            |
| D015 | 2026-06-17 | JSON Schema authoritative; generated TS/Python types                                                                               | Accepted                | [ADR 0007](../docs/adr/0007-contract-ownership-codegen.md)                                                                     |
| D014 | 2026-06-17 | Agents read scoped snapshot only; no agent DB                                                                                      | Accepted                | [architecture-context.md](architecture-context.md)                                                                             |
| D013 | 2026-06-17 | docker-compose: web + api + postgres; long-lived API                                                                               | Accepted                | [ADR 0004](../docs/adr/0004-runtime-topology.md)                                                                               |
| D012 | 2026-06-17 | Durable `replan_jobs` with leases                                                                                                  | Accepted                | [ADR 0005](../docs/adr/0005-plan-lineage-replan-jobs.md)                                                                       |
| D011 | 2026-06-17 | Re-plan creates new revision; prior superseded                                                                                     | Accepted                | [ADR 0005](../docs/adr/0005-plan-lineage-replan-jobs.md)                                                                       |
| D010 | 2026-06-17 | Denormalized `plan_steps.is_stale` authoritative                                                                                   | Superseded → D020       | —                                                                                                                              |
| D009 | 2026-06-17 | JSON Schema + SQL DDL dual artifacts                                                                                               | Accepted                | [ADR 0007](../docs/adr/0007-contract-ownership-codegen.md)                                                                     |
| D008 | 2026-06-17 | pnpm monorepo: Next.js + Hono + Python                                                                                             | Accepted                | [architecture-context.md](architecture-context.md)                                                                             |
| D007 | 2026-06-17 | Eval CLI + ephemeral DB isolation                                                                                                  | Accepted                | [ADR 0002](../docs/adr/0002-mvp-scope-trim.md)                                                                                 |
| D006 | 2026-06-17 | Clerk auth-gated multi-user                                                                                                        | Accepted                | [ADR 0006](../docs/adr/0006-clerk-identity-only.md)                                                                            |
| D005 | 2026-06-17 | Async in-process re-plan with in-place step refresh                                                                                | Superseded → D011, D012 | —                                                                                                                              |
| D004 | 2026-06-17 | `graph_mutations` + SSE for demo visibility                                                                                        | Accepted                | [ADR 0008](../docs/adr/0008-per-user-serialization-sse.md)                                                                     |
| D003 | 2026-06-17 | `TransferPoints` atomic domain mutation                                                                                            | Accepted                | [schema-final.md](../docs/architecture/schema-final.md), [architecture-context.md](architecture-context.md)                    |
| D002 | 2026-06-17 | In-process agent invocation via subprocess                                                                                         | Accepted                | [architecture-context.md](architecture-context.md)                                                                             |
| D001 | 2026-06-17 | Modular monolith runtime topology                                                                                                  | Accepted                | [architecture-context.md](architecture-context.md)                                                                             |

---

## Quick reference _(one line each — detail in canonical source)_

| ID   | One-line decision                                                                    |
| ---- | ------------------------------------------------------------------------------------ |
| D001 | One deployable (`apps/api` + `apps/web`); agents as subprocesses; eval CLI separate. |
| D002 | Orchestrator spawns Python via JSON stdin/stdout; no inter-agent prose.              |
| D003 | Single `TransferPoints` mutation; atomic debit/credit in graph-write.                |
| D004 | Append-only mutation log + SSE; REST catch-up on reconnect.                          |
| D005 | ~~In-place stale refresh~~ → superseded by revision model (D011, D012).              |
| D006 | Clerk required; shared world seed; personal/plan per user.                           |
| D007 | Benchmark uses `DATABASE_URL_EVAL` ephemeral DB only.                                |
| D008 | `apps/web` (Next.js), `apps/api` (Hono), `agents/` (Python).                         |
| D009 | JSON Schema + SQL DDL; no hand-written duplicate types.                              |
| D010 | ~~`plan_steps.is_stale` boolean~~ → superseded by D020 status lifecycle.             |
| D011 | Re-plan = new revision row; never restore stale revision to `current`.               |
| D012 | `replan_jobs` enqueued in same txn as invalidation.                                  |
| D013 | Local: compose web/api/postgres; hosted: managed PG + long-lived API.                |
| D014 | graph-query in API; agents get snapshot JSON only.                                   |
| D015 | Alan owns contracts; CI codegen diff gate.                                           |
| D016 | Identity only; bootstrap template; authenticated per-user reset.                     |
| D017 | Mutation log is audit/replay; not a work queue.                                      |
| D018 | Baselines write `plans` + `evaluations` only; partial runs recorded.                 |
| D019 | `plan_lineage_id` stable; partial unique index per lineage `current`.                |
| D020 | Plan status: `generating\|current\|stale\|failed\|superseded`.                       |
| D021 | Lease + `FOR UPDATE SKIP LOCKED`; atomic promotion txn.                              |
| D022 | `UNIQUE (user_id, operation_type, idempotency_key)` + hash.                          |
| D023 | Eval never deployed; demo PG is managed service when hosted.                         |
| D024 | `pg_advisory_xact_lock` per user before graph-write + mutations insert.              |
| D025 | All `graph_mutations.user_id NOT NULL` for MVP.                                      |
| D026 | No shell; env allowlist; configured timeout and output limits.                       |
| D027 | v3.1 spec locked; DDL authored; Phase A3 contracts next.                             |

---

## Related

- ADR process: [`docs/adr/README.md`](../docs/adr/README.md)
- Architecture detail: [`architecture-context.md`](architecture-context.md)
- Schema: [`docs/architecture/schema-final.md`](../docs/architecture/schema-final.md)
- Sprint board: [`STATUS.md`](../STATUS.md) _(operational only — not a decision log)_
