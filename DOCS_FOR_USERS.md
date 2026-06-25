# Rewards Agent

Rewards Agent is a demo project for planning credit-card rewards redemptions. It uses a shared typed graph so different specialist agents can coordinate through structured state instead of passing free-text messages.

## What You Can Do Now

- Read the sprint board in `STATUS.md`.
- Inspect the locked data model in `docs/architecture/schema-final.md`.
- Inspect the fixed demo wallet: five cards, three reward programs, and 240,000 total points for the Tokyo trip scenario.
- Load the shared demo rewards data into a test database after the schema is applied:

```bash
python scripts/load_seed.py fixtures/demo-seed.json
```

- For isolated local tests only, include the fixed demo person with:

```bash
python scripts/load_seed.py fixtures/demo-seed.json --include-demo-persona
```

- Review Person C's first redemption scenario: a seeded Tokyo Hyatt trip using Chase Ultimate Rewards points.
- Write that seeded redemption plan into the project database as a current plan with plan steps and dependency records.
- Run the current demo path locally: create the Tokyo plan, transfer Chase points to Hyatt, watch the old plan become stale or superseded, and show the new current plan.
- Use the Layer 4 cut runbook in `docs/demo/layer4-cut-contingency.md` when rehearsing the June 29 demo.
- Run the Person C planner tests with:

```bash
python -m unittest discover -s tests -v
```

- Run the Person C benchmark scorer with:

```bash
python -m benchmark.person_c_scorer --pretty
```

The current Person C slice is fixture-based. It can pick the best seeded Tokyo Hyatt redemption, write the plan into the database, detect when a Chase balance change makes the old plan stale, and prepare a new plan revision.

## Current Limitations

- This is not a consumer product and does not connect to real bank accounts.
- Award and cash prices are seeded fixture data, not live travel prices.
- The live demo uses Layers 1-3 only: seeded rewards data, typed graph mutations, and plan replanning.
- Layer 4, the planned ingestion and verifier layer, is cut for the June 29 demo. It should be described as future work, not as a feature being shown live.

## Recent Changes

- Added a fixture-backed Tokyo Hyatt redemption planner for Person C.
- Added a seeded award-search tool that returns typed graph fragments.
- Added tests covering recommendation, fallback, invalidation, and benchmark cases.
- Added an offline benchmark scorer for Person C's seeded cases.
- Fallback explanations now stay focused on awards that match the current trip.
- Added the fixed demo seed used by the hero flow. The seed loader loads shared rewards data by default; the fixed demo persona is opt-in for isolated tests.
- Added database-backed writing for the seeded redemption plan, including plan steps and balance dependencies.
- Added the RCG-51 clean demo contingency for the Layer 4 cut, with a presenter runbook and a checked fixture for the Layers 1-3 path.
