# 0003 — Team is Four; Eval Harness & Layer 4 Ownership

- **Status:** Accepted — June 17, 2026.
- **Owner:** Raq (lead)
- **Index:** [`context/decisions-log.md`](../../context/decisions-log.md)
- **Related:** [0002 — Keep the Research Apparatus](0002-mvp-scope-trim.md)

## Context
Ruijing is out completely. The team is four: Alan (A · Graph/Persistence), Val (B · Frontend/Demo), Michael (C · Redemption/Eval), Raq (D · Orchestrator, owner/lead). The eval harness and Layer 4 (ingestion + verifier) had been slated for Ruijing. The research apparatus is being kept in full (ADR 0002), so the benchmark, both baselines, and the eval harness still have to be staffed — now across four people.

## Decision

**Team = 4. No fifth person.** The "is Ruijing confirmed?" question is closed: no.

**Layer 4 is cut-by-default.** With four people and the full benchmark, the team cannot do both a well-tuned benchmark and Layer 4. The benchmark is the contribution; Layer 4 is a flourish. Layer 4 (ingestion + verifier) has **no committed owner**, remains a true hard-cuttable stretch, and the demo is planned to not depend on it. Revisit only if the team is ahead at the Day 10 go/no-go; if taken then, Michael leads with whole-team help.

**Ownership map:**

| Person | Owns |
|---|---|
| Alan (A) | Graph/Persistence (critical path) + `serialize_world_graph()` utility |
| Michael (C) | Redemption agent (HERO — protected) · 30-query benchmark + ground truth · Arch-2 (CrewAI free-text) baseline · eval metric definitions |
| Raq (D) | Orchestrator · wallet · earning · integration · lead · Arch-1 (single-agent) baseline · **eval-harness DRI** |
| Val (B) | Frontend/demo · sidebar · dependency-invalidation view · head-to-head contrast UI · eval-results visualization (week 2) |

**Eval harness model (resolves the "whole team" question):** whole-team *contribution*, single *DRI = Raq*. Each lane instruments its own metric surface (graph lane: token counts + staleness signal; each baseline owner: their token cost; redemption lane: "correct plan" definition; frontend: results display). The win thresholds are pre-committed before Day 7 with **all four signing off**. One shared **eval run on Day 8–9** where the team runs all 30 queries across the three architectures together and reviews failures.

## Consequences
- **Release valve:** if Day 7 slips, the first trim is the *second* baseline — drop Arch-2 (CrewAI), keep Arch-1 (single-agent). That preserves a real comparison without dropping the benchmark.
- **Kickoff agenda:** remove Ruijing from the room and the "if confirmed" lines; the lane section's "owner pending Ruijing" for Layer 4 becomes "unowned stretch, cut-by-default."
- **Linear:** remove the `owner: Ruijing (pending)` label from RCG-40–44 and RCG-50; mark Layer 4 as unowned stretch; assign the Arch-1 baseline (RCG-35) to Raq; add an eval-harness DRI ticket plus per-lane instrumentation sub-tasks and a "pre-commit win thresholds (all four sign off)" gate before Day 7.
- Michael's lane is still the heaviest of the four; the hero redemption agent is the thing we protect first if anything has to give.
