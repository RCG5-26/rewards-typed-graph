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
- Run the Person C planner tests with:

```bash
python -m unittest discover -s tests -v
```

- Run the Person C benchmark scorer with:

```bash
python -m benchmark.person_c_scorer --pretty
```

The current Person C slice is fixture-based. It can pick the best seeded Tokyo Hyatt redemption, detect when a Chase balance change makes the old plan stale, and choose the next valid option. It does not yet write to a real database.

## Current Limitations

- This is not a consumer product and does not connect to real bank accounts.
- Award and cash prices are seeded fixture data, not live travel prices.
- Database-backed plan writing is waiting on the graph-write path and shared mutation contracts.

## Recent Changes

- Added a fixture-backed Tokyo Hyatt redemption planner for Person C.
- Added a seeded award-search tool that returns typed graph fragments.
- Added tests covering recommendation, fallback, invalidation, and benchmark cases.
- Added an offline benchmark scorer for Person C's seeded cases.
- Fallback explanations now stay focused on awards that match the current trip.
- Added the fixed demo seed used by the hero flow. The seed loader now loads shared rewards data by default, and the fixed demo person is opt-in for isolated tests.
