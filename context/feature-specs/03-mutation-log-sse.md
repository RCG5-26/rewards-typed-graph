# 03 — Mutation log + SSE event contract

- **Status:** Draft
- **Owner:** Alan (producer) · Val (consumer) · **Lane:** Graph/Persistence ↔ Frontend/Demo
- **Linear:** RCG-14, RCG-25 (consumer wiring), RCG-24 (mock)
- **Depends on:** 02 (graph write path appends `graph_mutations`)
- **Related flows:** [Flow 1: Create a rewards plan](../project-overview.md), [Flow 2: Update state and automatically re-plan](../project-overview.md)

---

## Definition of ready (gate)

- [x] Goal and out-of-scope unambiguous
- [x] Acceptance criteria testable
- [x] Contracts linked
- [x] Touch list filled
- [x] Dependencies + Linear ids recorded
- [ ] Event field list signed off by Val (consumer)

---

## Goal

Define the `graph_mutations` event shape and the per-user Server-Sent-Events stream the demo sidebar subscribes to, including ordering and reconnect replay. This is the integration contract that lets Val build the streaming sidebar against a mock and swap to the real stream with no rework — it is the "make invisible coordination visible" surface.

---

## Contracts touched (link — do not restate the schema)

- **Consumes:** `graph_mutations` table ([`../../docs/architecture/schema-final.md`](../../docs/architecture/schema-final.md) §5.1).
- **Produces:** [`../../schema/contracts/mutation-event.schema.json`](../../schema/contracts/mutation-event.schema.json) — canonical SSE payload (ADR 0007).
- **Invariants:** per-user ordering via the advisory lock (ADR 0008); user-scoped (no cross-user fanout in MVP).

---

## Event model (decided)

| Choice            | Decision                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Granularity       | **One SSE event per `graph_mutations` row** — not a transaction-level envelope grouping multiple rows                                                 |
| Cursor / ordering | **`event_id` = `graph_mutations.id`** (bigserial). No separate `seq` column — per-user monotonic order when §6.3 advisory lock held                   |
| Field names       | Wire JSON mirrors DDL columns (`mutation_type`, `target_table`, `target_node_id`, `before`/`after`, …). `operation_type` is idempotency-only, not SSE |
| OCC `version`     | Lives inside `before`/`after` jsonb for versioned tables (e.g. `user_balances`), not a top-level SSE field                                            |

---

## Downstream behavior

- Client opens one SSE connection per user and receives **row-level** mutation events in commit order (shape validates against `mutation-event.schema.json`).
- SSE `Last-Event-ID` = `event_id`; reconnect replays rows with `id > Last-Event-ID` for that user (exactly once).
- The sidebar renders the stream live; `mutation_type` values such as plan/step staleness updates light affected plan steps (paired with spec 04 output).

---

## Out of scope

- The sidebar UI/visual design itself (Val's frontend spec — likely `01-design-system` + a sidebar spec).
- Cross-user broadcast / multi-tenant fanout.
- Authentication of the SSE endpoint beyond the existing user/session check.

---

## Implementation plan

1. **Done (contract):** [`schema/contracts/mutation-event.schema.json`](../../schema/contracts/mutation-event.schema.json) — generate TS/Python types per ADR 0007 when codegen lands.
2. SSE endpoint: `SELECT` new `graph_mutations` for the authenticated user, ordered by `id`; map columns 1:1 to the schema.
3. Replay: honor `Last-Event-ID` → resend rows with `id >` that cursor; REST `GET /mutations?after=` for catch-up.
4. Ship a mock event generator validating against the schema so Val builds the sidebar without the backend (RCG-24).

---

## Files / modules (expected touch list)

| Path                                          | Change                                       |
| --------------------------------------------- | -------------------------------------------- |
| `schema/contracts/mutation-event.schema.json` | **exists** — canonical event JSON Schema     |
| `packages/schema-ts/` (generated)             | add — TS type from schema when codegen wired |
| `src/api/stream.*`                            | create — SSE endpoint + replay               |
| `src/mock/mutation-stream.*`                  | create — schema-shaped mock generator        |
| `tests/api/stream.*`                          | create — ordering + replay tests             |

---

## Acceptance criteria

- [ ] Emitted events validate against `schema/contracts/mutation-event.schema.json`.
- [ ] Events arrive in commit order; `event_id` (`graph_mutations.id`) is monotonic per user.
- [ ] Reconnect with `Last-Event-ID` replays missed events exactly once (no dupes, no gaps).
- [ ] The mock generator emits the same shape as the live endpoint.
- [ ] typecheck + tests pass.

---

## Verification

```bash
npm test -- api/stream
```

**Manual check:** open the stream, commit a mutation via spec 02, see the event; kill and reopen the connection mid-stream and confirm clean replay.

---

## Open questions

| #   | Question                           | Blocking?        | Resolution                                                               |
| --- | ---------------------------------- | ---------------- | ------------------------------------------------------------------------ |
| 1   | Row-level vs transaction envelope? | —                | **Resolved:** one SSE event per `graph_mutations` row; `event_id` = `id` |
| 2   | Consumer sign-off on field list    | yes (Ready gate) | Val — review `mutation-event.schema.json`                                |
