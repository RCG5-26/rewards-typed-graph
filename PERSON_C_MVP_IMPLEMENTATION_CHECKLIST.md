# Person C MVP Implementation Checklist

## Brief Summary

Person C's MVP is a small, seeded proof of the redemption architecture: a graph-search agent plans a Chase-to-Hyatt redemption for a 3-night Tokyo trip, returns typed graph fragments from the award tool, and re-plans when the user's Chase balance changes. The goal is to prove the project thesis with a reliable demo and benchmark: structured graph state should reduce factual hallucinations and handle invalidation better than single-agent or free-text multi-agent baselines.

The first working version uses only seeded data: one Chase balance, one Hyatt transfer path, three realistic-looking Tokyo Hyatt hotel options, and one balance-change scenario. Success means the system picks the best-value hotel when the user has enough points, marks that plan stale after the balance changes, and recommends the best remaining valid option without inventing unsupported awards or transfer paths.

## Workspace Artifacts

This checklist is backed by executable Person C artifacts aligned to schema-final v3.1:

- `docs/implementation/person-c-redemption-traversal.md` - RCG-20 paper design for the redemption traversal and invalidation flow.
- `fixtures/person-c-mvp-seed.json` - tiny seeded Tokyo Hyatt domain for the MVP.
- `benchmark/gold/person-c-mvp-cases.json` - 11 MVP benchmark cases covering normal redemption, invalidation, cash fallback, hallucination traps, and benchmark integrity.
- `agents/redemption/planner.py` - deterministic fixture-backed planner that ranks awards, emits dependency-bearing plan drafts, and proves balance-change invalidation.
- `agents/redemption/award_tool.py` - seeded award-search tool that returns typed `RedemptionOption` and `ExternalQuote` fragments.
- `benchmark/person_c_scorer.py` - offline scorer for the typed fixture path.
- `tests/redemption/test_planner.py` - regression tests for the planner, tool fragment, and benchmark cases.
- `tests/eval/test_person_c_scorer.py` - regression tests for the scorer and CLI.

Current execution status:

- Done now: RCG-20 paper design, Tokyo seed fixture, 11-case benchmark draft, deterministic planner, seeded award tool, offline scorer, and unit tests.
- Still blocked: database-backed RCG-21 writes until the graph-write path, MutationBatch contract, and graph fragment merge contract are ready.

## Locked MVP Direction

Person C owns the redemption agent, graph-typed award tool, benchmark, baselines, and evaluation. The MVP should stay intentionally small so the team can prove the architecture instead of getting stuck building a travel data product.

Locked choices:

- Use graph search first; use the LLM only for ranking explanations and tradeoff language.
- Use seeded data only, not live award search.
- Focus on hotels only.
- Use Hyatt only.
- Use Chase Ultimate Rewards only.
- Use a Tokyo 3-night trip as the anchor scenario.
- Seed three realistic-looking Hyatt hotel options.
- Optimize first for highest cents-per-point value.
- Return typed graph fragments from the award-search tool.
- Use balance-change invalidation as the first dependency-tracking demo.
- Use rubric-based benchmark scoring.
- Use strict factual hallucination scoring.
- Include both a single-agent baseline and a simulated free-text multi-agent baseline.

## MVP Seed Data

Use realistic-looking seeded data. These do not need to be live or current prices; they just need to be internally consistent and documented as fixtures.

User state:

- User has 75,000 Chase Ultimate Rewards points at the start.
- Transfer path: Chase Ultimate Rewards to Hyatt at 1:1.
- Trip request: Tokyo, 3 nights.
- Invalidation update: user later says they used 40,000 Chase points.
- Remaining balance after update: 35,000 Chase points.

Hotel options:

| Demo Hotel          |    Award Cost | Seeded Cash Total |    Value | Role                             |
| ------------------- | ------------: | ----------------: | -------: | -------------------------------- |
| Demo Hyatt Ginza    | 45,000 points |            $1,050 | 2.33 cpp | Best value before balance change |
| Demo Hyatt Shinjuku | 30,000 points |              $540 | 1.80 cpp | Backup after balance change      |
| Demo Hyatt Ueno     | 24,000 points |              $300 | 1.25 cpp | Poor-value contrast option       |

The first plan should pick Demo Hyatt Ginza. After the user spends 40,000 points, the old 45,000-point plan should become stale and the agent should re-plan to Demo Hyatt Shinjuku.

## Build Order

### 1. Seed The Tiny Domain

Create the minimum graph data needed for one complete redemption flow:

- Chase currency node.
- Hyatt program node.
- Chase-to-Hyatt transfer edge with ratio 1:1.
- User balance node with 75,000 Chase points.
- Three Tokyo hotel nodes.
- Three award availability nodes.
- Cash price edges.
- Award cost edges.
- Fixture source/timestamp metadata.

Success criteria:

- The system can load the seeded graph.
- Each hotel has a point cost, cash price, availability status, and timestamp.

### 2. Build Graph Search

The redemption search should:

- Find valid transfer paths from Chase to Hyatt.
- Filter to Tokyo Hyatt options available for 3 nights.
- Filter out options the user cannot afford.
- Calculate cents-per-point value.
- Rank valid options by highest cents-per-point.
- Return cash fallback only if no valid award option fits the balance.

Success criteria:

- With 75,000 Chase points, the top result is Demo Hyatt Ginza.
- With 35,000 Chase points, the top result becomes Demo Hyatt Shinjuku.
- The search never recommends an unavailable or unaffordable award.

### 3. Build The Graph-Typed Award Tool

The award tool should accept:

- City.
- Dates or number of nights.
- Hotel program.
- User or query id.

The award tool should return a typed graph fragment, not plain JSON prose. The current executable slice returns:

- `RedemptionOption` nodes for each seeded hotel stay.
- `ExternalQuote` nodes for award availability and cash price.
- `redeems_via` edges from World of Hyatt to each redemption option.
- Source/timestamp metadata.

Success criteria:

- Tool output can be merged into the shared graph.
- Each returned award option has enough structure for dependency tracking.
- The same seeded tool data can be used by the typed-graph system and the baselines.

### 4. Generate The Redemption Plan

The plan should include:

- Recommended hotel.
- Transfer step: Chase to Hyatt.
- Points required.
- Cash value avoided.
- Cents-per-point value.
- Why this option won.
- Backup option.
- Dependency edges.

Current dependency coverage:

- Plan steps depend on the Chase balance with observed version and snapshot value.
- Award availability, award cost, cash price, and transfer ratio are carried as candidate fact slugs in step payloads until the graph-write contract defines how merged tool facts are referenced.

Success criteria:

- The plan is understandable to a non-technical user.
- The plan records enough dependencies to become stale when the balance changes.

### 5. Add Balance Invalidation

Demo flow:

1. User asks for the best Tokyo Hyatt redemption.
2. Agent recommends Demo Hyatt Ginza for 45,000 points.
3. User says they used 40,000 Chase points yesterday.
4. Balance changes from 75,000 to 35,000.
5. Old plan is marked stale.
6. Graph search re-runs.
7. Agent recommends Demo Hyatt Shinjuku for 30,000 points.

Success criteria:

- The old plan is not silently reused.
- The new recommendation respects the updated balance.
- The explanation says why the recommendation changed.

### 6. Create 10-12 MVP Benchmark Cases

Suggested split:

- 4 normal redemption cases.
- 3 balance-change invalidation cases.
- 2 hallucination traps.
- 2 cash fallback cases.
- Optional 1 explanation-quality case.

Each benchmark case should include:

- User query.
- Starting graph state.
- Expected valid transfer paths.
- Expected valid award options.
- Accepted top recommendation or accepted set.
- Required calculation checks.
- Disqualifying hallucinations.
- Invalidation expectation, if applicable.

Success criteria:

- Every case can be scored by rubric.
- The rubric separates factual hallucination from recommendation quality.

### 7. Build Baselines

Build two fair MVP baselines:

- Single-agent baseline.
- Simulated free-text multi-agent baseline.

Rules for fairness:

- Same seeded data.
- Same benchmark cases.
- Same available tools.
- Same or similar model budget.
- No shared typed graph.
- No structural dependency tracking.

The free-text multi-agent baseline can simulate agents passing text or JSON summaries between roles. It should be called "CrewAI-style" only if the team is clear that it is a simulated version, not the actual CrewAI framework.

Success criteria:

- Baselines are not intentionally weak.
- Any typed-graph win comes from graph state and dependency tracking, not from better data access.

### 8. Score Results

Primary metrics:

- Accuracy.
- Strict hallucination rate.
- Invalidation correctness.

Optional metrics:

- Tool calls per query.
- Token cost per query.
- Explanation quality.

Strict hallucination means only concrete factual errors:

- Nonexistent transfer partner.
- Wrong transfer ratio.
- Award availability not present in the tool result.
- Incorrect point balance.
- Unsupported hotel/program rule.

Success criteria:

- Results can be reported honestly even if the typed-graph system only wins some metrics.
- Invalidation correctness is highlighted as the architecture-specific win.

Current typed fixture-path result:

- 11 / 11 accuracy cases pass.
- 0 strict hallucinations.
- 2 / 2 invalidation cases pass.

Run it with `python -m benchmark.person_c_scorer --pretty`.

## MVP Risks And Alternatives

Risk: The MVP looks too small.

Alternative: Make the graph mutation and stale-plan behavior visible. The contribution is not the number of hotel programs; it is the structured coordination behavior.

Risk: Highest cents-per-point picks the "best value" but not necessarily the "best hotel."

Alternative: Label the recommendation as best value and show cash savings, points cost, and backup option clearly.

Risk: Seeded data feels fake.

Alternative: Use realistic-looking numbers, source timestamps, and an explicit note that fixture data is used so the demo is stable and benchmarkable.

Risk: Baselines take too much time.

Alternative: Keep them minimal but fair: same data, same queries, same tools, different coordination style.

## What To Tell The Team

Person C is building a tight seeded MVP that proves the core claim: a graph-search redemption agent using typed tool results can produce valid plans and re-plan when dependent state changes. The first demo is Chase to Hyatt for a 3-night Tokyo trip, with three seeded hotel options and a balance-change invalidation moment. The benchmark and baselines are small but fair, so the team can show evidence instead of only a demo.
