# Person B — Comparison Route Integration Patch (Fix 6)

The comparison route factory `createComparisonRoutes` lives in
`apps/api/src/comparison/routes.ts` and is owned by Person B. Mounting it touches
the shared, Person-A-owned `apps/api/src/app.ts`. To avoid a conflict-heavy
merge, **no new edit to `app.ts` is shipped on this branch** beyond the mount
already present at the freeze. The graph slot fails **closed** until the engine
is wired (see below), so the system is safe to merge as-is.

## Exact mount the integrator must ensure (apply AFTER Person A merges)

```ts
// apps/api/src/app.ts — inside createApp(deps)
app.route(
  "/",
  createComparisonRoutes({
    graphService: deps.planService,
    planEngine: deps.planEngine, // ← the one-line integration patch (Fix 2 + Fix 6)
  }),
);
```

The branch currently mounts it without `planEngine`:

```ts
app.route("/", createComparisonRoutes({ graphService: deps.planService }));
```

Adding `planEngine: deps.planEngine` is the **entire** integration change.

## Dependencies the route factory needs (`ComparisonDeps`)

| Field | Required | Source in `createApp` | Behavior if omitted |
|---|---|---|---|
| `graphService: GraphPlanRunner` | yes | `deps.planService` (booted `PlanService`) | n/a (already wired) |
| `planEngine?: PlanEngineKind` | recommended | `deps.planEngine` (boot-resolved; also on `/health`) | **fail-closed**: graph slot returns `engine_configuration_error`, never a mislabeled legacy plan |
| `graphUserId?: string` | no | omit (defaults to canonical demo persona) | uses `CANONICAL_GRAPH_USER_ID` |
| `runReport?: RunBaselineReport` | no | omit (defaults to real Python subprocess) | uses `runBaselineReport` |
| `env?: NodeJS.ProcessEnv` | no | omit (defaults to `process.env`) | uses `process.env` |

Required import (already present in `app.ts`):

```ts
import { createComparisonRoutes } from "./comparison/routes";
```

## Why fail-closed instead of a required field

`planEngine` is intentionally **optional** on `ComparisonDeps`. If the integrator
applies the patch, the live graph runs under `PLAN_ENGINE=orchestrator`. If the
patch is missed, `planEngine` is `undefined`, the guard treats that as "not
orchestrator", and the graph slot returns a sanitized `engine_configuration_error`
— the other two architectures are unaffected. A legacy-Python plan is therefore
**never** labeled `live-graph-orchestrator`.

## Expected conflict with Person A

`app.ts` already diverges from Person A because the freeze-era mount line was
added on this branch. The integrator should resolve that single mount line and,
while there, add `planEngine: deps.planEngine`. No other `app.ts` hunk comes from
Person B.
