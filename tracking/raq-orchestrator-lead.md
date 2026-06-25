# Raq — Person D · Orchestrator / Agents (owner, team lead)

**Lane:** orchestrator (NL query to graph operations), wallet agent, earning agent, cross-lane integration + API surface, agent harness. **Plus (ADR 0003): single-agent baseline + eval-harness DRI.** As owner and lead, you unblock everyone else first and own the integration surface that touches every other agent.

Update Today / Next / Blockers daily. Mirror your one-liner into the STATUS.md grid before standup.

## Today

- Scaffold the orchestrator + agent harness on mocks (RCG-15, [spec 05](../context/feature-specs/05-orchestrator-harness.md)) — builds against the locked interface; stub the write path until spec 02 lands.
- Push `raq/updates` (3 commits ready) and open the PR into `main`.

## Next

- Wallet + earning agents (RCG-16/17, [spec 06](../context/feature-specs/06-wallet-and-earning-agents.md)) once the write-path interface (spec 02) is stable.
- Single-agent baseline (RCG-35 — now mine per ADR 0003) and eval-harness DRI (RCG-40) + win-threshold gate (RCG-55), week 2.
- Integration contract / API surface (RCG-18); draft as spec 07.

## Blocked on

- Generated contracts (Phase A3, Alan) for real wiring — mocks OK now.
- GitHub connector auth (via `/mcp`) + `git push` to open the `raq/updates` PR.

## Recently done

- Documented the RCG-51 clean demo contingency for the Layer 4 cut: presenter runbook, machine-checked fixture, and unittest guard for the Layers 1-3 route/event path.
- Shipped the spec 07 API service (RCG-18, PR #29 → `main`): Hono + Clerk auth + CORS + 6 routes + SSE/REST mount + psql-subprocess hero bridge. Hero path (RCG-28/29) green and live-verified end-to-end; wrote [`../docs/development/backend-local-setup.md`](../docs/development/backend-local-setup.md) for the frontend handoff.
- Co-owned the schema lock → **v3.1 Accepted** (RCG-5 done, ADR 0001).
- Built and reconciled the Linear board (RCG-5–63): eval harness re-homed to me as DRI; single-agent baseline reassigned to me; Layer 4 cut-by-default; added eval-report (RCG-62) + e2e-integration (RCG-63) tickets.
- Wrote the feature-spec system + specs 02–06; the implement prompt; the source-of-truth map; README "how we work"; PR template; progress-tracker as AI memory + archive.
- Branch `raq/updates` with 3 doc commits; `STUDY_GUIDE.md` gitignored.

---

## My tickets

| ID     | Task                                                                                          | Phase     | Status                  |
| ------ | --------------------------------------------------------------------------------------------- | --------- | ----------------------- |
| RCG-5  | Schema lock (co-own with Alan)                                                                | Day 1-2   | ✅ done (v3.1 Accepted) |
| RCG-15 | Orchestrator + agent harness — [spec 05](../context/feature-specs/05-orchestrator-harness.md) | Day 1-5   | ◐ scaffolding on mocks  |
| RCG-16 | Wallet agent — [spec 06](../context/feature-specs/06-wallet-and-earning-agents.md)            | Day 3-5   | next                    |
| RCG-17 | Earning agent — [spec 06](../context/feature-specs/06-wallet-and-earning-agents.md)           | Day 3-5   | next                    |
| RCG-18 | Integration contract / API surface (spec 07)                                                  | Day 1-5   | ✅ done (PR #29, live-verified) |
| RCG-19 | Cross-lane conflict resolution path                                                           | Day 1-5   | pending write path      |
| RCG-35 | Single-agent baseline (mine per ADR 0003)                                                     | Day 7-10  | ✅ implemented (LLM-call runner, tests) |
| RCG-40 | Eval harness / benchmark runner (DRI)                                                         | Day 7-10  | not started             |
| RCG-55 | Pre-commit benchmark win thresholds (all four sign off)                                       | Day 7     | not started             |
| RCG-28 | Full Layer 1-3 integration (query → plan)                                                     | Day 5-7   | ✅ done (PR #20/#29, live)|
| RCG-29 | Hero Moment 1 (balance change → auto re-plan)                                                 | Day 5-7   | ✅ done (PR #20/#29, live)|
| RCG-32 | Day 7 gate: end-to-end demo path working                                                      | Day 7     | ◐ in progress (backend green; frontend wiring + Clerk browser run) |
| RCG-39 | Day 10 Layer 4 GO / NO-GO decision                                                            | Day 10    | done - NO-GO for demo   |
| RCG-62 | Head-to-head eval report + architecture write-up (co-own)                                     | Day 10-14 | blocked on RCG-37       |
| RCG-47 | Demo script (persona, hero moments, head-to-head, closing)                                    | Day 10-14 | open                    |
| RCG-48 | Full demo rehearsals                                                                          | Day 10-14 | open                    |
| RCG-51 | Contingency: clean demo path with Layer 4 cut                                                 | Day 10-14 | done                    |

## Owner / lead responsibilities (beyond my lane)

- Clear the Active Blockers list in STATUS.md every standup; reconcile Linear statuses that lag the code.
- Own schema change control: after lock, any change goes through me and is checked against existing `state_dependencies` first.
- Run the PR/merge flow (CodeRabbit + `main` ruleset); connect the GitHub connector.
- Make the Day 7 and Day 10 calls. Day 7 slips → cut scope, do not extend.
- Keep the team anchored on coordination semantics, not data format.

## My risk

My lane now carries the orchestrator + agents **and** the single-agent baseline + the eval-harness DRI. The orchestrator/integration path and the Day 7 gate come first — lean on mocks now, and use the freed week-2 buffer (Layer 4 cut-by-default) for the baseline + harness. Ship wallet + earning early so the back half is integration and unblocking, not feature work.
