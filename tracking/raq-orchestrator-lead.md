# Raq — Person D · Orchestrator / Agents (owner, team lead)

**Lane:** orchestrator (NL query to graph operations), wallet agent, earning agent, cross-lane integration + API surface, agent harness. **As owner and lead, you unblock everyone else first and own the integration surface that touches every other agent.**

Update Today / Next / Blockers daily. Mirror your one-liner into the STATUS.md grid before standup.

## Today
- Review Alan's schema draft; run the lock meeting with Alan (RCG-5).
- Scaffold the orchestrator + agent harness against the locked interface (RCG-15).

## Next
- Wallet agent (personal-graph mutations) and earning agent (RCG-16, RCG-17). These ship early so you can shift to integration.
- Lock the integration contract so Val and Michael are not blocked on you (RCG-18).

## Blocked on
- schema draft from Alan (clears at lock)

---

## My tickets

| ID | Task | Phase | Done when |
|---|---|---|---|
| RCG-5 | Schema lock (review + run the room; co-own with Alan) | Day 1 | all four lanes sign off |
| RCG-15 | Scaffold orchestrator + agent harness (typed-mutation interface) | Day 1-5 | agents commit mutations through one path, no free text |
| RCG-16 | Wallet agent (personal-graph mutations: balances, status, goals) | Day 3-5 | balance mutation triggers Hero Moment 1 |
| RCG-17 | Earning agent (card to category multiplier reasoning) | Day 3-5 | recommends best card per category |
| RCG-18 | Integration contract / API surface between lanes | Day 1-5 | Val and Michael can build against it independently |
| RCG-19 | Cross-lane conflict resolution path | Day 1-5 | rejected-commit handling is bounded |
| RCG-28 | Full Layer 1-3 integration (query to plan) | Day 5-7 | NL query produces a multi-step plan end to end |
| RCG-29 | Hero Moment 1 (balance change to auto re-plan) | Day 5-7 | structural invalidation + auto re-plan, no orchestrator nudge |
| RCG-32 | Day 7 gate: end-to-end demo path working | Day 7 | full path + Hero Moment 1 runs on the persona |
| RCG-39 | Day 10 Layer 4 GO / NO-GO decision | Day 10 | decision made and recorded |
| RCG-47 | Demo script (persona, 2 hero moments, head-to-head, closing) | Day 10-14 | timed under 10 min |
| RCG-48 | Full demo rehearsals (x3) | Day 10-14 | rehearsed, fragile transitions caught |
| RCG-51 | Contingency: clean demo path with Layer 4 cut | Day 10-14 | Plan B rehearsed |

## Owner / lead responsibilities (beyond my lane)
- Clear the Active Blockers list in STATUS.md every standup.
- Own schema change control: after lock, any change goes through you and is evaluated against existing dependency edges before any mutation.
- Make the Day 7 and Day 10 calls. Day 7 slips → cut scope, do not extend.
- Keep the team anchored on coordination semantics, not data format, so the contribution does not collapse into "we used a database."

## My risk
The integration surface is where cross-lane conflicts surface as real engineering problems. Ship wallet + earning early (Days 3-5) so the back half is integration and unblocking, not feature work.
