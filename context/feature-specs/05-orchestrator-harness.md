# 05 — Orchestrator + agent harness

- **Status:** Draft
- **Owner:** Raq · **Lane:** Orchestrator/Agents
- **Linear:** RCG-15
- **Depends on:** schema-final v3.1; spec 02 (graph write path) — can start against the *interface* before 02 is finished
- **Related flows:** [Flow 1: Create a rewards plan](../project-overview.md), [Flow 2: Update state and automatically re-plan](../project-overview.md)

---

## Definition of ready (gate)

- [x] Goal and out-of-scope unambiguous
- [x] Acceptance criteria testable
- [x] Contracts linked
- [x] Touch list filled
- [x] Dependencies + Linear ids recorded
- [ ] Confirm the spec 02 `commitMutation` signature before wiring agents to the real path (stub until then)

---

## Goal

The orchestrator loop and the agent base/harness that every agent runs inside. The orchestrator decomposes a natural-language query into graph operations and invokes the specialist agents; the harness gives each agent one way to act — commit a typed mutation through the graph write path (spec 02) — and records its run. This is the scaffold that makes "coordination is typed mutations only" true in code, and it can be built against the locked interface before the write path is finished.

---

## Contracts touched (link — do not restate the schema)

- **Consumes:** the `commitMutation` interface from [`02-graph-write-path.md`](02-graph-write-path.md); `Plan`, `PlanStep`, `AgentRun` and the `agent_runs.state` checkpoint shape in [`../../docs/architecture/schema-final.md`](../../docs/architecture/schema-final.md) §3–§4.
- **Produces:** `Plan` rows (orchestrator is the sole writer) and `AgentRun` rows (one per agent run, with `last_read_versions` checkpoint).
- **Invariants:** typed graph mutations only — **the agent base class must make free-text inter-agent messaging impossible**; agents act only through `commitMutation`.

---

## Downstream behavior

- A query produces a `Plan` and a sequence of agent runs; each agent reads graph state and commits typed mutations; nothing is passed agent-to-agent as prose.
- Each `AgentRun` records its checkpoint (`last_read_versions`) so a crashed/resumed run can tell whether its inputs changed.

---

## Out of scope

- The agents' own logic — wallet/earning (spec 06), redemption (spec 04).
- The write path itself (spec 02) — this spec consumes its interface and stubs it until ready.
- The durable re-plan queue (`replan_jobs`, RCG-57) and the cross-lane API surface (RCG-18 — its own spec).

---

## Implementation plan

1. Agent base class: a single `commit(mutation, readSet, idempotencyKey)` that delegates to spec 02; no other write path exists for agents.
2. `AgentRun` lifecycle: open a run, write checkpoints (`last_read_versions`), close on success/failure.
3. Orchestrator loop: NL query → graph operations → invoke agents in order → assemble the `Plan`.
4. Stub `commitMutation` (in-memory) so the harness runs end to end before spec 02 lands; swap to the real one when ready.

---

## Files / modules (expected touch list)

| Path | Change |
|---|---|
| `src/orchestrator/*` | create — query decomposition + loop |
| `src/agents/base.*` | create — agent base class / harness, run lifecycle |
| `src/agents/commit-stub.*` | create — temporary in-memory write path for tests |
| `tests/orchestrator/*` | create — see acceptance |

---

## Acceptance criteria

- [ ] A persona query produces a `Plan` and ordered agent runs.
- [ ] The agent base class exposes only `commit(...)`; there is no API for an agent to message another in free text.
- [ ] Each `AgentRun` records a checkpoint with `last_read_versions`.
- [ ] The harness runs end to end against the stub write path (no dependency on spec 02 being done).
- [ ] typecheck + tests pass.
- [ ] No invariant from `../architecture-context.md` violated.

---

## Verification

```bash
npm test -- orchestrator
```

**Manual check:** run the persona query through the harness with the stub; confirm a `Plan` + `AgentRun` rows appear and no free-text channel exists.

---

## Open questions

| # | Question | Blocking? | Resolution |
|---|---|---|---|
| 1 | Final `commitMutation` signature (spec 02) | no | Stub now; align when 02 lands |
