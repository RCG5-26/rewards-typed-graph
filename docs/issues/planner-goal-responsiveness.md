# [BE] Agent plan is identical for every goal — planner ignores the query

**Severity:** High (core "agent reasoning" is not actually responsive to user input)
**Component:** API planner — `agents/redemption/planner.py`, fixture `fixtures/person-c-mvp-seed.json`
**Requires redeploy:** Yes — runs inside the Railway API; signed-in users won't see changes until the API service is redeployed.

## Symptom

Every query produces the same three steps regardless of the stated goal — "maximize
points", "hit the welcome bonus before the deadline", "cashback for groceries" all
return:

1. Transfer 45,000 Chase Ultimate Rewards points to World of Hyatt
2. Book Demo Hyatt Ginza for 45,000 Hyatt points
3. Keep Demo Hyatt Shinjuku as the backup

The goal label in the UI changes (FE string-matches the query), but the **plan
content, transfer path, and graph never change.**

## Root cause

`plan_redemption()` (`agents/redemption/planner.py`) is a deterministic fixture
replay. The query text reaches the planner but is only consulted in one place:

- **`_unsupported_query_reason()`** — returns a cash-fallback **only if the query
  literally contains the substring `"marriott"`**. For every other query, the text
  is discarded.

Everything else is driven by the fixture's fixed `scope`, not the goal:

- **`_query_scoped_awards()`** filters candidate awards only by
  `scope.target_program_slug` (Hyatt), `scope.destination_city` (Tokyo), and
  `scope.nights` (3).
- **`_active_transfer_path()`** hardcodes source→dest to `scope.source_program_slug`
  (Chase UR) → `scope.target_program_slug` (Hyatt).
- Step action strings are templated to "Chase Ultimate Rewards → World of Hyatt".

Current fixed scope (`fixtures/person-c-mvp-seed.json`):

```json
{
  "source_program_slug": "program:chase_ur",
  "target_program_slug": "program:hyatt",
  "destination_city": "Tokyo",
  "nights": 3
}
```

### Secondary issue (same root): every step shares one dependency

Every step is given the _same single dependency_ — the source Chase balance — via
`dependency=dependency` on each `_step(...)` call. The writer
(`tests/integration/redemption_graph_writer.py` `_dependency_request_from_planner`)
further forces every `state_dependency` to `target_table="user_balances"` pointed at
the source balance id. Result: every step's dependency chip renders "Chase Ultimate
Rewards", and the typed graph only ever contains the Chase→Hyatt→award path.

### Secondary issue: selected cards never reach the planner

The onboarding card selection is sent to the FE stream route as `?cards=…` but goes
nowhere:

1. The stream route only **validates** them (`selectedCardIdsError`), then calls
   `createPlan(queryText, token)` — cards are never passed.
2. The client sends `body: { query }` only — no cards.
3. The API contract `POST /plans` doesn't accept cards — `parseQuery` reads only
   `body.query`.

So even after the planner is made goal-aware, cards still won't matter until the
`POST /plans` contract is extended to accept and use them.

## Expected behavior

The plan should vary with the user's goal/query. At minimum, distinct goal types
should yield distinguishable plans + graphs, e.g.:

- **maximize points** → current transfer-to-Hyatt path
- **cashback / minimize fees** → recommend cash/statement-credit instead of a transfer
- **specific redemption** (different city/program named in the query) → select awards
  matching the requested destination/program

## Acceptance criteria

- [ ] Two queries with different goals produce different `steps` and a different
      `graph` projection.
- [ ] Query intent (goal type, and where data allows, destination/program)
      measurably influences award selection and the transfer path — not just the FE label.
- [ ] Steps carry dependencies reflecting the nodes they actually touch (dest
      program, redemption option), not just the source balance.
- [ ] Selected cards reach the planner (extend `POST /plans` + stream route +
      client) and influence the plan.
- [ ] Unsupported-goal handling generalizes beyond the hardcoded `"marriott"`
      substring check.

## Notes / scope flag

- The seed fixture currently only contains **Hyatt / Tokyo / 3-night** award data,
  so genuine destination/program variety needs the fixture (or backing DB seed)
  expanded, and/or a real query-parsing/LLM planning step. Worth a scoping decision:
  "branch on goal type within existing seed data" (small) vs. "parse query + richer
  award catalog" (larger).
- Frontend is ready: it already renders whatever typed graph + dependencies the API
  returns. No FE blocker. See the typed-graph view notes in
  [`docs/development/backend-local-setup.md`](../development/backend-local-setup.md#typed-graph-traversal-view-web-tier).
