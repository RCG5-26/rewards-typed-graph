# 0007 — Contract Ownership and Codegen

- **Status:** Accepted — June 18, 2026.
- **Owner:** Alan (Graph/Persistence); Raq (orchestrator contracts)
- **Index:** [`context/decisions-log.md`](../../context/decisions-log.md) (D009, D015, D026)
- **Related:** [0001 — Schema Lock](0001-schema-lock.md), [`architecture-context.md`](../../context/architecture-context.md) §Type ownership

## Context

TypeScript API, Python agents, and the frontend must agree on mutation shapes, subprocess I/O, and SSE payloads. Hand-written duplicate types drift from SQL and from each other within days.

## Decision

**Two authoritative artifacts**

1. **JSON Schema** in `schema/contracts/` — API requests/responses, `MutationBatch`, agent invocation limits, tool payloads, benchmark fixtures, SSE event shape.
2. **SQL DDL** in `schema/schema.sql` — persistence only.

**Generated consumers (no manual duplication)**

- TypeScript: `packages/schema-ts/` generated from JSON Schema.
- Python: `agents/schema_py/` generated from JSON Schema.
- CI diff gate: generated output must match schema on every PR touching contracts.

**Ownership**
| Contract area | DRI |
|---|---|
| Graph mutation / TransferPoints / idempotency | Alan |
| Agent invocation + stdout `MutationBatch` | Alan (shape); Raq (launcher enforcement) |
| Planning request, orchestrator routes | Raq |
| SSE event envelope | Alan + Val |

**Python subprocess operational contract** (enforced by `launcher.ts`, documented in `agent-invocation.json`)

- `spawn()` without shell; JSON stdin → single JSON document on stdout.
- Exit codes: `0` success, `1` validation, `2` timeout, other = unexpected.
- Configured execution timeout and maximum output size; exceed → validation failure.
- Environment allowlist only; **no `DATABASE_URL`** or other secrets passed to subprocess.
- stderr = logs only; sanitized before persistence.

**Agent read boundary**

- Python agents receive scoped snapshot JSON from graph-query only; no direct SQL.

## Consequences

- Phase A3 delivers `schema/contracts/` before application scaffolding merges.
- Contract tests verify mutation JSON maps to writable DDL columns.
- Any schema or contract change updates JSON Schema, regenerates types, and updates DDL additively per ADR 0001.
