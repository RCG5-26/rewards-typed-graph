# Michael — Person C · Redemption / Eval (+ Layer 4)

**Lane:** the redemption agent (the hero reasoning surface), graph-typed tools, the 30-query benchmark, both baselines, and Layer 4 (ingestion + verifier). **Baselines are a first-class deliverable: an undertuned baseline invalidates the whole comparison.**

Update **Today / Next / Blockers** daily in this file. Open a **tiny PR** (this file only) — merge same day. Update **Linear** (RCG-##) to match. **Do not** edit `STATUS.md` in feature PRs — the lead syncs the standup grid from `tracking/` + Linear.

## Today

- RCG-20/31 executable slice is in place: Tokyo Hyatt fixture, deterministic planner, seeded award tool, 11 benchmark cases, and offline scorer.
- Tests prove initial recommendation, balance-change invalidation, cash fallback, award availability overrides, integer basis-point math, typed tool fragments, and scorer report output.
- PR review fixes are addressed: fallback diagnostics are query-scoped, and invalidation scoring uses the Chase balance slug instead of fixture list position.
- RCG-21 graph-writer bridge is in place: planner output writes `plans`, `plan_steps`, and `state_dependencies` through `V31GraphWriteService`, and `hero_flow.py` is wired for synchronous revision-2 promotion.
- RCG-21 branch is synced with latest `main`; non-live test suite is green, with live Postgres tests still skipped in environments without `psql`.
- RCG-36 free-text multi-agent baseline has an initial deterministic runner: role-tagged free-text handoffs, JSON tool outputs, same gold cases, final-plan-only persistence shape.

## Next

- Support Raq on live Postgres hero verification if the RCG-28/29/32 path exposes redemption-writer gaps.
- Harden the RCG-36 baseline around the shared eval config/model budget once that decision lands.

## Blocked on

- Full hero proof needs a live Postgres run of `test_hero_end_to_end`.
- Baseline model calls need the shared eval config/model budget decision.

---

## My tickets

| ID     | Task                                                           | Phase             | Done when                                                     |
| ------ | -------------------------------------------------------------- | ----------------- | ------------------------------------------------------------- |
| RCG-20 | Design redemption traversal (on paper)                         | Day 1-5           | written approach; NL goal to graph query mapped               |
| RCG-21 | Redemption agent (multi-hop traversal + tradeoff surfacing)    | Day 1-5           | emits multi-step plan with reasoning per step                 |
| RCG-22 | Award-search tool (fixtures first), typed subgraph fragments   | Day 1-5           | returns graph fragment, not JSON                              |
| RCG-23 | Graph-typed tool contract (envelope + merge/provenance)        | Day 1-5           | fragments upsert by slug + version with provenance            |
| RCG-30 | Connect real cash-price tool                                   | Day 5-7           | one real tool returns a typed fragment                        |
| RCG-31 | Begin benchmark fixture construction                           | Day 5-7           | gold corpus + queries started against seed data               |
| RCG-33 | Build 30-query benchmark (earning/redemption/portfolio)        | Day 7-10          | 30 queries with ground-truth recommendations                  |
| RCG-34 | Operationalize hallucination-rate metric                       | Day 7-10          | ratio vs program-existence defined; point-in-time gold corpus |
| RCG-35 | Single-agent baseline (well-tuned)                             | Day 7-10          | tuned, same tools/budget as main system                       |
| RCG-36 | Free-text multi-agent baseline (CrewAI-style, well-tuned)      | Day 7-10          | strong; JSON tools instead of graph fragments                 |
| RCG-37 | Run benchmark across all three architectures                   | Day 7-10          | accuracy, hallucination, invalidation, token cost reported    |
| RCG-38 | Plan-invalidation correctness metric (wins by kind)            | Day 7-10          | baselines structurally score zero here                        |
| RCG-40 | Layer 4: eval harness                                          | Day 10+ (stretch) | gated by Day 10 go/no-go                                      |
| RCG-41 | Layer 4: ingestion agent (text to proposed mutations)          | Day 10+ (stretch) | proposes only; verifier decides                               |
| RCG-42 | Layer 4: verifier (schema, existing edges, ratio transitivity) | Day 10+ (stretch) | rejects bad mutations with reasons                            |
| RCG-43 | Layer 4: adversarial verifier set (3 rejection modes)          | Day 10+ (stretch) | schema + node-ref + ratio-transitivity each covered           |
| RCG-44 | Layer 4 demo path (press release to new edge)                  | Day 10+ (stretch) | shows >=1 rejection, not just acceptance                      |
| RCG-49 | Release benchmark + domain-update set                          | Day 10-14         | packaged for public release                                   |
| RCG-50 | Adversarial verifier set passes before demo                    | Day 10-14         | only if Layer 4 landed                                        |

## Layer 4 is yours

The team plan assigns Layer 4 (ingestion + verifier) to you. Linear has been updated so RCG-40 through RCG-44 and RCG-50 carry your ownership (the earlier "Ruijing (pending)" placeholder is removed). Treat Layer 4 as hard-cuttable at the Day 10 go/no-go.

## My risks

- **Weak baselines.** The free-text baseline must be well-tuned CrewAI with the same agents and tools (returning JSON instead of graph fragments). Treat baseline quality as a deliverable, not a checkbox.
- **Layer 4 timeline.** Hard go/no-go Day 10. If not converging, cut cleanly and demo Layers 1-3. A half-working ingestion agent that silently corrupts the graph is worse than no Layer 4.
- **Hallucination metric honesty.** Measure against a static gold corpus of ratios at a point in time; distinguish hallucinated ratios from hallucinated program existence.
