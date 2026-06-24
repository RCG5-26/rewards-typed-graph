# Person C Redemption Traversal Plan

This is the RCG-20 paper design and executable fixture-backed prototype for the first redemption path. It aligns to schema-final v3.1 where contracts exist and stays short of database writes until the graph-write path and MutationBatch contracts are ready.

## Done And Correct

The first Person C slice is correct when the system can answer one seeded Tokyo Hyatt query, write a plan with explicit read dependencies, mark that plan stale after the Chase balance changes, and re-plan to the best still-affordable option without inventing hotels, transfer paths, prices, or award availability.

Assumptions:

- MVP redemption scope is Chase Ultimate Rewards to Hyatt only.
- MVP search is hotels only, not flights.
- Seeded data is the source of truth until live tools are added.
- Graph search chooses candidates first; the LLM only explains tradeoffs and ranking.
- Balance-change invalidation is the first architectural proof point.

## Anchor Scenario

User asks for the best 3-night Tokyo Hyatt redemption.

Seeded starting state:

- User has 75,000 Chase Ultimate Rewards points.
- Chase Ultimate Rewards transfers to Hyatt at 1:1.
- Three Tokyo Hyatt options are available from the seeded award tool.

Expected first plan:

- Pick Demo Hyatt Ginza for 45,000 points and $1,050 seeded cash value.
- Cite 2.33 cents per point as the reason it wins on value.
- Include Demo Hyatt Shinjuku as the backup option.
- Record that the plan depends on the Chase balance and the award facts used.

Expected invalidation path:

- User later spends 40,000 Chase points.
- Chase balance becomes 35,000 points.
- The old 45,000-point plan is stale.
- Re-run search.
- Pick Demo Hyatt Shinjuku for 30,000 points and $540 seeded cash value.

## Traversal

1. Normalize the user goal into a query object.
   - Destination: Tokyo.
   - Trip length: 3 nights.
   - Preferred program family: Hyatt.
   - Optimization: highest cents-per-point value.

2. Read the user's relevant personal state.
   - Chase Ultimate Rewards balance.
   - Hyatt status, if present.
   - Any active user goal constraints.

3. Find valid transfer paths.
   - Start from the Chase Ultimate Rewards program.
   - Traverse transfer edges to Hyatt.
   - Reject any path with no active ratio or no modeled destination program.
   - For MVP, require exactly one hop: Chase to Hyatt.

4. Fetch seeded award candidates through the award tool.
   - Tool returns graph fragments, not prose.
   - Fragment includes `RedemptionOption` and `ExternalQuote`-style facts with source and fetched timestamp.
   - Fragment is merged before planning so every recommendation points back to graph facts.

5. Generate candidates.
   - Keep only Tokyo Hyatt options matching the requested trip length.
   - Keep only available awards.
   - Convert required Hyatt points back to required Chase points using the transfer ratio.
   - Reject candidates that exceed the current Chase balance.

6. Score candidates.
   - `value_basis_points = cash_total_cents * 10000 / points_required`, rounded with integer math.
   - Rank by highest cents per point.
   - Tie-break by lower points required, then lower cash total.

7. Write the plan.
   - Plan step 1: transfer recommendation.
   - Plan step 2: redemption recommendation.
   - Plan step 3: backup option or cash fallback.
   - Each step stores the factual inputs used and the explanation text.

8. Record dependency edges.
   - Always depend on the Chase balance node and observed version.
   - MVP `state_dependencies` are node-valued personal dependencies only, so balance invalidation is the first automated proof point.
   - Carry award availability, cash quote, and transfer route slugs in plan payloads until graph-write defines merged tool-fact references.
   - Do not claim transfer-ratio invalidation until edge-valued/world-fact dependency handling is deliberately added.

9. Re-plan on staleness.
   - When the balance version changes, the old plan step is stale.
   - Write a new plan step version and mark the old one superseded.
   - Explain the reason as "your Chase balance changed from 75,000 to 35,000 points, so the 45,000-point option no longer fits."

## Graph-Typed Award Tool Contract

Minimum envelope:

```json
{
  "fragment_id": "award-search:tokyo-hyatt-3n:v1",
  "source_tool": "seed_award_search",
  "fetched_at": "2026-06-18T00:00:00Z",
  "nodes": [],
  "edges": []
}
```

Current executable node kinds for the MVP:

- `RedemptionOption` for each seeded hotel stay.
- `ExternalQuote` for award availability.
- `ExternalQuote` for cash price.

Current executable edge kinds for the MVP:

- `redeems_via`: World of Hyatt to each `RedemptionOption`.

Merge rule:

- Upsert world/tool facts by stable slug.
- Increment version only when factual attributes change.
- Preserve `source_tool` and `fetched_at`.
- Reject fragments missing a source or timestamp.

## Remaining Integration Questions

Person C cannot safely finish database-backed RCG-21 until these are settled:

- What is the exact graph fragment envelope accepted by the merge path?
- What is the final MutationBatch shape for creating `plan_steps` and `state_dependencies`?
- How should merged `external_quotes` be referenced from plan step payloads before world-fact invalidation exists?
- What stable seed slugs will Alan commit for Chase, Hyatt, the demo user, and the Tokyo options?

## Implementation Order

1. Done: map `fixtures/person-c-mvp-seed.json` to schema-final terminology.
2. Done: implement pure graph-search ranking with no LLM dependency.
3. Done: add the seeded award tool returning typed graph fragments.
4. Done: prove balance-change invalidation in memory from recorded balance dependencies.
5. Done: add offline benchmark scoring for the typed fixture path.
6. Next: map plan drafts to graph-write MutationBatch once spec 02 is ready.
7. Next: add fair baseline runners against the same scorer/report shape.

## Verification

```bash
python -m unittest discover -s tests -v
python -m benchmark.person_c_scorer --pretty
```

Current typed fixture-path result: 11 / 11 accuracy, 0 strict hallucinations, and 2 / 2 invalidation cases passing.

## Manual Verification Checklist

- With 75,000 Chase points, the top recommendation is Demo Hyatt Ginza.
- After a 40,000-point spend, Chase balance is 35,000.
- The original Ginza plan is stale or superseded.
- The new top recommendation is Demo Hyatt Shinjuku.
- No output names a hotel, transfer partner, ratio, price, or award not present in the seed fixture.
