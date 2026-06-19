# Val — Person B · Frontend / Demo

**Lane:** demo shell, the graph-mutation streaming sidebar, plan-node "lighting up" on invalidation, the baseline contrast UI, demo polish. **You make the invisible coordination visible. The architectural claim is half rendered as a UI element.**

Update Today / Next / Blockers daily. Mirror your one-liner into the STATUS.md grid before standup.

## Today
- Card API research **done** — endpoints/shape understood, ready to feed the demo shell and mock event design.
- Design system **ready to be added** — tokens/components staged for the demo shell.
- Wireframes flow mapped (query → plan → sidebar → contrast view).
- Continue demo shell scaffold + graph-mutation sidebar against mocked events (RCG-27, RCG-24).

## Next
- Add the design system into the shell and wire the wireframe flow.
- Auth: stand up sign-in, **likely Clerk** (evaluate fit for the demo).
- Match mock event shape to the agreed mutation-log fields (coordinate with Alan on RCG-14).
- Plan-node dependency view that lights up stale nodes (RCG-26).

## Blocked on
- nothing (work on mocks from Day 3; wire real events Days 5-7)

---

## My tickets

| ID | Task | Phase | Done when |
|---|---|---|---|
| RCG-24 | Graph-mutation sidebar against mocked data | Day 1-5 | mutations stream in visibly |
| RCG-27 | Demo shell scaffold (query input, plan + per-step reasoning) | Day 1-5 | persona query renders a multi-step plan |
| RCG-26 | Plan-node dependency view: stale nodes light up | Day 1-5 | invalidation is visible on screen |
| RCG-25 | Wire sidebar to real streaming mutation events | Day 5-7 | live mutations from all agents appear |
| RCG-45 | Head-to-head contrast UI (visual diff between architectures) | Day 10-14 | same scenario, typed-graph vs baselines, side by side |
| RCG-46 | Benchmark numbers display in demo | Day 10-14 | accuracy, hallucination, invalidation, token cost shown |

## What the demo needs from me (the three visible moments)
1. Mutations streaming as agents coordinate (sidebar).
2. Hero Moment 1: a balance change lights up stale plan nodes, then a re-plan appears.
3. Head-to-head: the baseline visibly hallucinates a ratio, misses the invalidation, and re-fetches a tool result.

## My risk
Demo dependency on backend streams. Build on mocked streaming events from Day 3; do not wait for real integration. Lock the event shape with Alan early so the swap to real events (Days 5-7) is trivial.
