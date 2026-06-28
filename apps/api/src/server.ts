import { serve } from "@hono/node-server";
import { Pool } from "pg";

import { createApp } from "./app";
import { bootPlanService } from "./plans/engine-selector";

const port = Number(process.env.API_PORT ?? 8787);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
const databaseUrl = requireEnv("DATABASE_URL");
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const devUserId = process.env.AUTH_DEV_USER_ID;

// The dev-user bypass only applies outside production. A stray AUTH_DEV_USER_ID
// in a shared/deployed env is ignored (and warned about) so Clerk stays required.
const allowDevBypass = process.env.NODE_ENV !== "production";
if (devUserId && !allowDevBypass) {
  console.warn("AUTH_DEV_USER_ID is set in production; ignoring it and requiring Clerk auth.");
}

const pool = new Pool({ connectionString: databaseUrl });

// Engine selection happens once at boot (M5 / ADR 0010 §3): PLAN_ENGINE must be
// set explicitly to `python-legacy` or `orchestrator`, or the server fails fast.
// Orchestrator mode additionally fails fast until the production adapters land.
const {
  engine: planEngine,
  service: planService,
  evidence: planEngineEvidence,
} = bootPlanService(process.env, { pool });

const app = createApp({
  planEngine,
  planService,
  pool,
  corsOrigin,
  auth: { clerkSecretKey, devUserId, allowDevBypass },
});

/** Require a named environment variable at process boot. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required environment variable: ${name}`);
  }
  return value;
}

serve({ fetch: app.fetch, port }, (info) => {
  // Safe structured boot evidence — no secrets, only the selected engine and
  // the no-fallback posture (a reviewer can confirm which engine served a run).
  console.log(
    `API listening on http://localhost:${info.port}`,
    JSON.stringify({ planEngine: planEngineEvidence }),
  );
});
