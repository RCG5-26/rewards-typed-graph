import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import type { Pool } from "pg";

import { createBalancesRoutes } from "./balances/routes";
import { createComparisonRoutes } from "./comparison/routes";
import { type AuthEnv } from "./http/auth";
import { resolveIdentity } from "./http/clerk-auth";
import { createMutationRoutes } from "./mutations/routes";
import type { PlanEngineKind } from "./plans/engine-selector";
import { createPlanRoutes } from "./plans/routes";
import type { PlanService } from "./plans/service";

export interface AppDeps {
  /** Selected plan engine, surfaced on `/health` so a reviewer can confirm it. */
  readonly planEngine: PlanEngineKind;
  readonly planService: PlanService;
  readonly pool: Pool;
  readonly corsOrigin: string;
  readonly auth: {
    readonly clerkSecretKey?: string;
    readonly devUserId?: string;
    readonly allowDevBypass: boolean;
  };
}

/**
 * Assemble the HTTP app from already-resolved dependencies. Kept free of process
 * boot concerns (env reads, pool construction, `serve`) so it can be exercised in
 * tests — in particular the boot→`/health` engine contract (M5 / ADR 0010 §3).
 */
export function createApp(deps: AppDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  app.use(
    "*",
    cors({
      origin: deps.corsOrigin,
      allowHeaders: ["Authorization", "Content-Type", "Last-Event-ID"],
      exposeHeaders: ["Last-Event-ID"],
      allowMethods: ["GET", "POST", "OPTIONS"],
    }),
  );

  app.use("*", async (c, next) => {
    const identity = await resolveIdentity(
      c.req.header("Authorization"),
      {
        clerkSecretKey: deps.auth.clerkSecretKey,
        devUserId: deps.auth.devUserId,
        allowDevBypass: deps.auth.allowDevBypass,
      },
      {
        findUserIdByClerkId: async (clerkId) => {
          const result = await deps.pool.query<{ id: string }>(
            "SELECT id FROM users WHERE clerk_id = $1",
            [clerkId],
          );
          return result.rows[0]?.id;
        },
      },
    );
    if (identity.userId) {
      c.set("userId", identity.userId);
    }
    if (identity.clerkId) {
      c.set("clerkId", identity.clerkId);
    }
    c.set("email", identity.email ?? null);
    await next();
  });

  app.get("/health", (c) => c.json({ ok: true, engine: deps.planEngine }));
  app.route("/", createMutationRoutes(deps.pool));
  app.route("/", createBalancesRoutes());
  app.route("/", createPlanRoutes(deps.planService));
  // The demo comparison drives the live graph through the same PlanService and
  // the two read-only Python baselines via subprocess (env + cwd from boot).
  // planEngine is threaded through so the graph slot only runs the LIVE
  // orchestrator and fails closed under any other engine (Fix 2 / Fix 6).
  app.route(
    "/",
    createComparisonRoutes({
      graphService: deps.planService,
      planEngine: deps.planEngine,
      replanService: deps.planService,
      // Pool lets each comparison run reset the canonical persona's balances
      // before the architectures read them, so the controlled scenario holds
      // even after a prior replan mutated the wallet.
      pool: deps.pool,
    }),
  );

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status);
    }
    console.error("unhandled API error", error);
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}
