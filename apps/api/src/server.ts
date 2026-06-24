import { serve } from "@hono/node-server";
import { verifyToken } from "@clerk/backend";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { Pool } from "pg";

import { type AuthEnv } from "./http/auth";
import { createMutationRoutes } from "./mutations/routes";
import { BridgePlanService } from "./plans/bridge-service";
import { createPlanRoutes } from "./plans/routes";

const port = Number(process.env.API_PORT ?? 8787);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
const databaseUrl = requireEnv("DATABASE_URL");
const clerkSecretKey = process.env.CLERK_SECRET_KEY;
const devUserId = process.env.AUTH_DEV_USER_ID;

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
  c.set("userId", await resolveUserId(c.req.header("Authorization")));
  await next();
});

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", createMutationRoutes(pool));
app.route("/", createPlanRoutes(planService));

/**
 * Resolve the caller to a `users.id`. Production verifies the Clerk bearer token
 * and maps `sub` (clerk_id) → users.id. For local curl/testing without Clerk,
 * `AUTH_DEV_USER_ID` short-circuits to a fixed seeded user.
 */
async function resolveUserId(
  authorization: string | undefined,
): Promise<string | undefined> {
  if (devUserId) {
    return devUserId;
  }

  const token = parseBearer(authorization);
  if (!token || !clerkSecretKey) {
    return undefined;
  }

  let clerkId: string;
  try {
    const claims = await verifyToken(token, { secretKey: clerkSecretKey });
    clerkId = claims.sub;
  } catch {
    return undefined;
  }

  const result = await pool.query<{ id: string }>(
    "SELECT id FROM users WHERE clerk_id = $1",
    [clerkId],
  );
  return result.rows[0]?.id;
}

function parseBearer(authorization: string | undefined): string | undefined {
  if (!authorization) {
    return undefined;
  }
  const [scheme, value] = authorization.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : undefined;
}

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
