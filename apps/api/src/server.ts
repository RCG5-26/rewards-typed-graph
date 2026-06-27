import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { Pool } from "pg";

import { type AuthEnv } from "./http/auth";
import { resolveIdentity } from "./http/clerk-auth";
import { createMutationRoutes } from "./mutations/routes";
import { BridgePlanService } from "./plans/bridge-service";
import { createPlanRoutes } from "./plans/routes";

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
const planService = new BridgePlanService();

const app = new Hono<AuthEnv>();

app.use(
  "*",
  cors({
    origin: corsOrigin,
    allowHeaders: ["Authorization", "Content-Type", "Last-Event-ID"],
    exposeHeaders: ["Last-Event-ID"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.use("*", async (c, next) => {
  const identity = await resolveIdentity(
    c.req.header("Authorization"),
    { clerkSecretKey, devUserId, allowDevBypass },
    {
      findUserIdByClerkId: async (clerkId) => {
        const result = await pool.query<{ id: string }>(
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

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", createMutationRoutes(pool));
app.route("/", createPlanRoutes(planService));

/** Require a named environment variable at process boot. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required environment variable: ${name}`);
  }
  return value;
}

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }
  console.error("unhandled API error", error);
  return c.json({ error: "internal server error" }, 500);
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`API listening on http://localhost:${info.port}`);
});
