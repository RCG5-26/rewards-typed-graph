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

- **Consumes:** `graph_mutations` table ([`../../docs/architecture/schema-final.md`](../../docs/architecture/schema-final.md) infra tables).
- **Produces:** the SSE event type + its JSON Schema in `schema/contracts/` (the canonical "mutation-log event shape" both backend and frontend validate against, ADR 0007).
- **Invariants:** per-user ordering via the advisory lock (ADR 0008); user-scoped (no cross-user fanout in MVP).

---

## Downstream behavior

- Client opens one SSE connection per user and receives mutation events in commit order: `{seq, ts, agent, op (insert|update), node_type|edge_type, id, summary (old→new), version}`.
- On reconnect with `Last-Event-ID`, the stream replays missed events from that seq exactly once.
- The sidebar renders the stream live; stale-flip events let it light up affected plan steps (paired with spec 04 output).

---

## Out of scope

- The sidebar UI/visual design itself (Val's frontend spec — likely `01-design-system` + a sidebar spec).
- Cross-user broadcast / multi-tenant fanout.
- Authentication of the SSE endpoint beyond the existing user/session check.

---

## Implementation plan

1. Define the event TS type + JSON Schema in `schema/contracts/mutation-event.*` (one source of truth; codegen per ADR 0007).
2. Add a per-user monotonic `seq` to `graph_mutations` (or derive from the ordered insert).
3. SSE endpoint: stream new `graph_mutations` for the user, ordered by `seq`.
4. Replay: honor `Last-Event-ID` → resend events with `seq >` that id.
5. Ship a mock event generator matching the schema so Val builds the sidebar without the backend (RCG-24).

---

## Files / modules (expected touch list)

| Path | Change |
|---|---|
| `schema/contracts/mutation-event.*` | create — event JSON Schema + generated type |
| `src/api/stream.*` | create — SSE endpoint + replay |
| `src/mock/mutation-stream.*` | create — schema-shaped mock generator |
| `tests/api/stream.*` | create — ordering + replay tests |

---

## Acceptance criteria

- [ ] Emitted events validate against `schema/contracts/mutation-event` schema.
- [ ] Events arrive in commit order; `seq` is monotonic per user.
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

| # | Question | Blocking? | Resolution |
|---|---|---|---|
| 1 | `seq` stored column vs ordered-insert derivation? | no | Alan to pick during 02; either works for the contract |
