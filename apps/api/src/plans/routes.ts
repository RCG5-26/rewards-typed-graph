import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { type AuthEnv, getAuthIdentity, getAuthenticatedUserId } from "../http/auth";
import { PlanServiceError, type PlanService } from "./service";
import { type BalanceTransferInput } from "./types";

const HTTP_STATUS_BY_ERROR_CODE = {
  validation: 400,
  not_found: 404,
  conflict: 409,
} as const;

/**
 * Plan + session HTTP surface (spec 07). Depends only on the `PlanService` port,
 * so these routes are exercised in tests with an in-memory fake — no DB, no
 * Clerk, no Python. The production service is injected at boot in `server.ts`.
 */
export function createPlanRoutes(service: PlanService) {
  const app = new Hono<AuthEnv>();

  app.get("/session", async (c) => {
    const identity = getAuthIdentity(c);
    return c.json(await callService(() => service.getSession(identity)));
  });

  app.post("/demo/reset", async (c) => {
    const userId = getAuthenticatedUserId(c);
    return c.json(await callService(() => service.resetDemo(userId)));
  });

  app.post("/plans", async (c) => {
    const userId = getAuthenticatedUserId(c);
    const body = await readJsonBody(c.req.raw);
    const query = parseQuery(body);
    const cardSlugs = parseCardSlugs(body);
    return runService(() => service.createPlan(userId, query, cardSlugs), (plan) =>
      c.json(plan),
    );
  });

  app.get("/plans/current", async (c) => {
    const userId = getAuthenticatedUserId(c);
    const lineageId = parseRequiredId(c.req.query("lineageId"), "lineageId");
    const plan = await callService(() => service.getCurrentPlan(userId, lineageId));
    if (!plan) {
      throw new HTTPException(404, { message: "no current plan for lineage" });
    }
    return c.json(plan);
  });

  app.get("/plans/:planId", async (c) => {
    const userId = getAuthenticatedUserId(c);
    const plan = await callService(() => service.getPlanById(userId, c.req.param("planId")));
    if (!plan) {
      throw new HTTPException(404, { message: "plan not found" });
    }
    return c.json(plan);
  });

  app.post("/balance-transfer", async (c) => {
    const userId = getAuthenticatedUserId(c);
    const input = parseTransferInput(await readJsonBody(c.req.raw));
    return runService(
      () => service.transferBalance(userId, input),
      (result) => c.json(result),
    );
  });

  return app;
}

/**
 * Run a `PlanService` call, mapping typed domain errors to their HTTP status.
 * Every service-backed route goes through this so a bridge `not_found`/`conflict`
 * surfaces as 404/409 instead of leaking out as a generic 500.
 */
async function callService<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof PlanServiceError) {
      throw new HTTPException(HTTP_STATUS_BY_ERROR_CODE[error.code], {
        message: error.message,
      });
    }
    throw error;
  }
}

/** Map domain errors then pass the successful value to a response builder. */
async function runService<T>(
  call: () => Promise<T>,
  respond: (value: T) => Response,
): Promise<Response> {
  return respond(await callService(call));
}

/** Parse JSON from the request body or reject with HTTP 400. */
async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HTTPException(400, { message: "invalid JSON body" });
  }
}

/** Validate and normalize the natural-language plan query from ``POST /plans``. */
function parseQuery(body: unknown): string {
  const query = asRecord(body).query;
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new HTTPException(400, { message: "query must be a non-empty string" });
  }
  return query.trim();
}

/** Validate the balance-transfer payload from ``POST /balance-transfer``. */
function parseTransferInput(body: unknown): BalanceTransferInput {
  const record = asRecord(body);
  const sourceProgramId = parseRequiredId(record.sourceProgramId, "sourceProgramId");
  const destProgramId = parseRequiredId(record.destProgramId, "destProgramId");
  if (sourceProgramId === destProgramId) {
    throw new HTTPException(400, {
      message: "sourceProgramId and destProgramId must differ",
    });
  }

  const amountPoints = record.amountPoints;
  if (
    typeof amountPoints !== "number" ||
    !Number.isInteger(amountPoints) ||
    !Number.isSafeInteger(amountPoints) ||
    amountPoints <= 0
  ) {
    throw new HTTPException(400, {
      message: "amountPoints must be a positive safe integer",
    });
  }

  let idempotencyKey: string | undefined;
  if (record.idempotencyKey !== undefined) {
    if (typeof record.idempotencyKey !== "string" || record.idempotencyKey.trim().length === 0) {
      throw new HTTPException(400, {
        message: "idempotencyKey must be a non-empty string when provided",
      });
    }
    idempotencyKey = record.idempotencyKey.trim();
  }

  return {
    sourceProgramId,
    destProgramId,
    amountPoints,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

/** Require a non-empty string id field from a JSON body or query param. */
function parseRequiredId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HTTPException(400, { message: `${field} is required` });
  }
  return value.trim();
}

/** Extract optional cardSlugs string array from a JSON body (silently ignores malformed values). */
function parseCardSlugs(body: unknown): string[] | undefined {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const raw = record.cardSlugs;
  if (!Array.isArray(raw)) return undefined;
  const slugs = raw.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
  return slugs.length > 0 ? slugs : undefined;
}

/** Narrow an unknown JSON body to a plain object or reject with HTTP 400. */
function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null) {
    throw new HTTPException(400, { message: "request body must be an object" });
  }
  return body as Record<string, unknown>;
}
