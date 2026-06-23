# 0002 — MVP Scope: Keep the Research Apparatus

- **Status:** Accepted — June 17, 2026. Decision: **retain** the research apparatus.
- **Owner:** Raq (lead)
- **Index:** [`context/decisions-log.md`](../../context/decisions-log.md) (D007)
- **Related:** [0001 — Schema Lock](0001-schema-lock.md), [`schema-v2.md`](../architecture/schema-v2.md), [`planning-brief.pdf`](../planning-brief.pdf)

## Context

A trimmed scope statement described the system as four layers over Postgres plus a demo-grade application (manually-entered wallet, 20 pre-seeded cards, one real tool, fixture award availability). That statement did not mention the research apparatus — the 30-query benchmark, the two baselines, and the evaluation harness — so the question was raised: are those being cut?

## Decision

**Do not drop the research apparatus.** The 30-query benchmark, both baselines (single-agent + free-text multi-agent / CrewAI-style), the evaluation harness, and the five metrics (accuracy, hallucination rate, token cost, plan-invalidation correctness, domain-extension correctness) remain first-class deliverables. The released benchmark is the project's primary lasting contribution.

Rationale: the four layers prove the system works; only the head-to-head proves it is better, which is the proposal's actual thesis. It is also half the demo's argument and the contribution that survives even if the hypothesis is partially rejected.

## Consequences

### Schema: no change

`schema-v2.md` already supports the full apparatus and the lock is unchanged. Everything the benchmark needs stays: the `Evaluation` node and its five metric columns, `Plan.plan_type` baseline values (`baseline_single_agent`, `baseline_free_text_multiagent`), `AgentRun.token_count`, and Person A's `serialize_world_graph()` utility (the baselines read the same world graph through it). The B1–B5 and I1–I3 items from the schema review all stand.

### Linear and the planning brief: no change

The benchmark, baseline, and evaluation tickets (RCG-33 through RCG-38, RCG-46, RCG-49) stay open. The planning brief's head-to-head demo segment and the "Michael / Person C is the most loaded lane" framing remain accurate.

### The real cost: Person C (Michael) is the overloaded lane — our top schedule risk

Keeping the apparatus means Michael again carries the redemption agent (hero) **plus** two baselines **plus** the 30-query benchmark **plus** the eval harness **plus** Layer 4. The mocking/hypothesis analysis named this as the schedule risk to surface at kickoff. We protect it deliberately:

1. **Move Architecture 1 (single-agent baseline) to Raq (Person D).** It is a single Claude call that injects `serialize_world_graph()` output as context and uses the same tools — close to orchestrator/integration work, and Raq has slack in week 2. Michael keeps Architecture 2 (CrewAI free-text), which mirrors the multi-agent structure he already owns.
2. **Ruijing is out — see [0003](0003-team-four-eval-ownership.md).** The team is four. The eval harness becomes whole-team contribution with Raq as DRI; Layer 4 becomes an unowned, cut-by-default stretch. The single-agent baseline moves to Raq; Michael keeps the CrewAI baseline.
3. **Adopt the revised baseline timeline:** Architecture 1 on Days 3–5, Architecture 2 on Days 5–8, benchmark runs Days 7–10. Baseline construction is not a Day-7 cleanup task; cramming a well-tuned CrewAI build into the last three days is how the comparison ends up weak.
4. **Pre-commit the win thresholds before Day 7:** >10pp over both baselines on accuracy and hallucination; categorical on plan-invalidation (baselines score 0 by design). Decide criteria before running, and report a negative result honestly if it lands that way.
5. **Freeze the benchmark ground-truth as-of date.** Michael drafts the 30 queries + ground truth by Day 5; full team reviews Day 5.

## Optional, separate cleanup (not part of this decision)

`Merchant` and `Transaction` (plus the `CATEGORIZED_AS` / `PAID_WITH` edges) are still "no writes in MVP" placeholders and could be dropped to slim the schema. This is orthogonal to the benchmark — decide it on its own merits at the lock, not as part of this ADR. `SpendCategory` and `RedemptionOption` stay regardless (earning and redemption agents need them).
