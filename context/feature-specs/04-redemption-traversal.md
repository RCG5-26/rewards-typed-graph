# 04 — Redemption agent traversal (the hero)

- **Status:** Draft
- **Owner:** Michael · **Lane:** Redemption/Eval
- **Linear:** RCG-20 (paper design), RCG-21 (implementation)
- **Depends on:** 02 (graph write path), schema-final v3.1, RCG-22/23 (graph-typed tools / `external_quotes`)
- **Related flows:** [Flow 1: Create a rewards plan](../project-overview.md), [Flow 2: Update state and automatically re-plan](../project-overview.md)

**Prototype note:** RCG-20 now has an executable fixture-backed slice under `agents/redemption/` with Tokyo seed data, tests, and an offline scorer under `benchmark/`. The database-backed RCG-21 implementation remains blocked on spec 02 and MutationBatch/fragment merge contracts.

---

## Definition of ready (gate)

- [x] Goal and out-of-scope unambiguous
- [x] Acceptance criteria testable
- [x] Contracts linked
- [x] Touch list filled
- [x] Dependencies + Linear ids recorded
- [ ] Paper design (RCG-20) reviewed before implementation (RCG-21)

---

## Goal

The redemption agent turns a natural-language goal into a multi-step plan by traversing the transfer/redeem graph (`source -transfers_to-> dest -redeems_via-> option`), surfacing the tradeoffs on each step (transfer vs. portal, fees, loyalty status, transfer time), and writing the plan so it is **re-planable**: every step records the world/personal state it relied on as `state_dependencies` with the observed version and a value snapshot. This is the reasoning surface the whole demo is built around.

---

## Contracts touched (link — do not restate the schema)

- **Consumes:** `transfers_to`, `redeems_via`, `redemption_options`, `user_balances`, `user_program_statuses` ([`../../docs/architecture/schema-final.md`](../../docs/architecture/schema-final.md) §1–§4) and `external_quotes` produced by graph-typed tools (RCG-22/23).
- **Produces:** `plan_steps` and `state_dependencies` — **only via the graph write path (spec 02)**, never direct SQL.
- **Invariants:** typed graph mutations only (no free-text inter-agent messages); ratios/CPP in integer basis points (no float); plan-node dependencies only (no transitive).

---

## Downstream behavior

- Given a query + the persona, returns an ordered set of plan steps, each with: the action, the reasoning, and a net-value comparison (e.g. "transfer 60k UR → Hyatt at 1:1; 2.1 cpp vs. 1.5 cpp portal").
- Each `plan_step` carries ≥1 `state_dependency` to the exact node(s) it used, with `observed_version` + `snapshot_value`, so a later change to that state marks the step stale (handled by spec 02).

---

## Out of scope

- The automatic re-plan trigger/loop and the durable queue (`replan_jobs`, RCG-57) — this spec produces the plan + dependencies; the loop consumes them.
- The baselines and the benchmark harness (separate specs/tickets).
- Real award availability (fixture-based for MVP).

---

## Implementation plan

1. Paper design (RCG-20): the traversal + ranking approach and the prompt structure for tradeoff narration. Review before coding.
2. Traversal: recursive CTE from the user's holdings/balances across `transfers_to` → `redeems_via` to candidate redemptions for the goal.
3. Rank candidates by value (cpp basis points), net of fees, transfer time, and status benefits; pull cash/award comparisons from `external_quotes`.
4. LLM step: narrate the chosen path and the alternatives considered, per step.
5. Write `plan_steps` + `state_dependencies` (observed_version + snapshot) through spec 02's `commitMutation`.

---

## Files / modules (expected touch list)

| Path | Change |
|---|---|
| `agents/redemption/*` | created — fixture-backed planner and seeded award tool prototype |
| `fixtures/person-c-mvp-seed.json` | created — Tokyo Hyatt seed fixture |
| `benchmark/gold/person-c-mvp-cases.json` | created — 11 executable MVP cases |
| `benchmark/person_c_scorer.py` | created — offline scorer for accuracy, hallucination, and invalidation |
| `tests/redemption/*` | created — prototype regression tests |
| `tests/eval/*` | created — scorer regression tests |
| `src/agents/redemption/*` | create — traversal, ranking, narration |
| `src/agents/redemption/queries.sql` | create — recursive CTE traversal |
| `tests/agents/redemption/*` | create — see acceptance |

---

## Data & schema

- **Tables:** reads world/personal graph; writes `plan_steps`, `state_dependencies` (via spec 02). Link schema-final; do not redefine.
- **Seed data:** the demo persona (RCG-8).

---

## Acceptance criteria

- [ ] For the Tokyo persona, produces a multi-step plan with per-step reasoning and a net-value comparison.
- [ ] Every `plan_step` has ≥1 `state_dependency` with an `observed_version` and `snapshot_value`.
- [ ] Changing a depended-on `user_balance` marks exactly the dependent steps stale (integration with spec 02).
- [ ] All value math uses integer basis points (no float).
- [ ] The agent writes only through the graph write path (spec 02) — verified by static check.
- [ ] typecheck + tests pass.
- [ ] Hard constraint respected: no free-text inter-agent messages.

---

## Verification

```bash
npm test -- agents/redemption
```

**Manual check:** run the persona query → inspect the returned plan + its `state_dependencies`; mutate a balance and confirm the right steps go stale.

---

## Open questions

| # | Question | Blocking? | Resolution |
|---|---|---|---|
| 1 | Ranking weights (cpp vs. fees vs. time vs. status) | no | Set in paper design (RCG-20); tune against the benchmark |
