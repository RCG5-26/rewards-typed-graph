# 06 — Wallet + earning agents

- **Status:** Draft
- **Owner:** Raq · **Lane:** Orchestrator/Agents
- **Linear:** RCG-16 (wallet), RCG-17 (earning)
- **Depends on:** 02 (graph write path), 05 (orchestrator + agent harness)
- **Related flows:** [Flow 1: Create a rewards plan](../project-overview.md), [Flow 2: Update state and automatically re-plan](../project-overview.md)

---

## Definition of ready (gate)

- [x] Goal and out-of-scope unambiguous
- [x] Acceptance criteria testable
- [x] Contracts linked
- [x] Touch list filled
- [x] Dependencies + Linear ids recorded
- [ ] Spec 02 write path available (or its stub from spec 05) before integration tests

---

## Goal

The two simpler agents in the orchestrator lane. The **wallet agent** is the sole writer of personal-tier state (balances, status, goals) — including the mid-conversation balance change that triggers the hero re-plan. The **earning agent** reads card-to-category earn edges and recommends the best card per spend category, writing its contribution as plan steps. Both act only through the graph write path (spec 02), inside the harness (spec 05).

---

## Contracts touched (link — do not restate the schema)

- **Consumes:** `user_balances`, `user_program_statuses`, `user_goals` (personal graph) and `earns` + `spend_categories` (world graph) in [`../../docs/architecture/schema-final.md`](../../docs/architecture/schema-final.md) §1, §3.
- **Produces:** wallet → personal-tier mutations; earning → its own plan-step contributions — all via `commitMutation` (spec 02).
- **Invariants (mutation ownership):** wallet is the **sole** writer of personal-tier nodes; earning writes only its own plan-step contributions and never personal/world state; ratios/multipliers in integer basis points.

---

## Downstream behavior

- Wallet: "I transferred 60k Chase to Hyatt" → updates the `user_balance` in place (version increments), which (via spec 02) marks dependent plan steps stale. This is the trigger for Hero Moment 1.
- Earning: "which card for dining?" → returns the highest `earn_rate_basis_points` card for that category, with the reasoning, as a plan-step contribution.

---

## Out of scope

- The redemption agent (spec 04) and the orchestrator/harness itself (spec 05).
- The re-plan loop/queue (`replan_jobs`, RCG-57) — wallet only _triggers_ staleness via the write path; it does not run the re-plan.
- The cross-lane API surface (RCG-18 — its own spec).

---

## Implementation plan

1. **Wallet agent:** update-in-place on `user_balances` (unique `user_id, program_id`) via `commitMutation`; same for status/goals. Carry the read-set so OCC + staleness fire.
2. **Earning agent:** query `earns` for a category (respecting caps / validity), rank by basis points, write the recommendation as a plan-step contribution via `commitMutation`.
3. Wire both into the harness (spec 05) as agents with only the `commit(...)` capability.

---

## Files / modules (expected touch list)

| Path                     | Change                                  |
| ------------------------ | --------------------------------------- |
| `src/agents/wallet/*`    | create — personal-state mutations       |
| `src/agents/earning/*`   | create — category → best-card reasoning |
| `tests/agents/wallet/*`  | create — balance update → staleness     |
| `tests/agents/earning/*` | create — best-card-per-category         |

---

## Acceptance criteria

- [ ] Wallet updates a balance in place (one row per `user_id, program_id`), version increments, and dependent plan steps go stale (integration with spec 02).
- [ ] Wallet is the only writer touching personal-tier nodes (static check).
- [ ] Earning returns the correct best card per category from `earns`, respecting caps/validity, with reasoning.
- [ ] All value math uses integer basis points (no float).
- [ ] Both agents write only through `commitMutation` (spec 02) — no direct SQL.
- [ ] typecheck + tests pass.

---

## Verification

```bash
npm test -- agents/wallet agents/earning
```

**Manual check:** run the wallet balance-change on the persona and confirm the right plan steps flip stale; ask an earning query and confirm the top card.

---

## Open questions

| #   | Question                                      | Blocking? | Resolution                                       |
| --- | --------------------------------------------- | --------- | ------------------------------------------------ |
| 1   | Tie-break when two cards have equal earn rate | no        | Pick lower annual fee; confirm in implementation |
