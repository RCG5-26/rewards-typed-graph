# RCG-51 - Clean Demo Path With Layer 4 Cut

**Status:** Layer 4 is cut for the June 29 demo. The demo path is Layers 1-3 only.

This runbook keeps the live demo honest if someone asks about the planned ingestion and verifier layer. Show the shipped coordination loop instead: the seeded wallet, a typed plan, graph mutation events, a balance transfer, structural invalidation, and the new current plan revision.

## Success Criteria

The demo is done and correct when it can be rehearsed from the seeded persona through:

1. `POST /demo/reset` or `GET /session` confirms the seeded user.
2. `POST /plans` creates the Tokyo plan.
3. `GET /mutations/stream` or `GET /mutations` shows typed graph mutation events.
4. `POST /balance-transfer` transfers Chase UR to Hyatt.
5. The old plan becomes stale or superseded, and `GET /plans/current` returns the replanned current revision.
6. No step depends on Layer 4 ingestion, verifier routes, mutation proposals, or global mutation events.

## Presenter Line

Layer 4 was a hard-cuttable stretch and is cut for this demo. The live proof is Layers 1-3: typed graph mutations, dependency tracking, and structural replanning.

## What To Show

1. Start with the fixed Tokyo rewards persona from `fixtures/demo-seed.json`.
2. Create the plan from the demo query and show the plan steps.
3. Open the mutation sidebar or replay the event list and point out that each visible change is a typed mutation.
4. Transfer 30,000 Chase Ultimate Rewards points to Hyatt.
5. Show that the dependent plan revision is no longer the actionable plan.
6. Show revision 2 as the current plan, with the transfer step removed because Hyatt now has enough points.
7. Close with the benchmark or comparison UI if it is available; otherwise close on the mutation log plus plan revision history.

## What Not To Show

- Do not demo Layer 4 ingestion or verifier endpoints. Show the mutation log and replanning path instead because those are already live on `main`.
- Do not mention `MutationProposal` as a shipped feature. Say mutation proposals belong to the cut Layer 4 work.
- Do not show global mutation events. The MVP sidebar is user-scoped; use the user-scoped REST/SSE events instead.
- Do not imply the system learned a new world fact during the demo. The demo proves structural replanning from typed user-state changes.

## Fallbacks

If SSE drops, use `GET /mutations?after=<lastEventId>` for catch-up. If the UI still cannot stream in time, replay `fixtures/mock-mutation-events.json` and label it as a fixture replay of the same Layers 1-3 event contract.

If the live API or Postgres is unavailable during rehearsal, use `fixtures/mock-plan.json` and `fixtures/mock-mutation-events.json` as a clearly labeled contract replay. Keep the presenter line unchanged: Layer 4 is cut, and the contingency is a replay of the shipped Layers 1-3 contract.

If someone asks what happened to Hero Moment 2, say: "We cut Layer 4 on purpose. A half-working ingestion and verifier loop would weaken the demo; the shipped proof is typed coordination plus dependency-driven replanning."

## Related Files

- `fixtures/demo-contingency-layer4-cut.json` - machine-checked contingency fixture.
- `docs/meetings/sprint-plan-jun24-29.md` - sprint-level cut decision and demo checklist.
- `docs/adr/0003-team-four-eval-ownership.md` - Layer 4 cut-by-default decision.
- `docs/development/backend-local-setup.md` - local API and demo startup.
