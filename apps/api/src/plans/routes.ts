import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { type AuthEnv, getAuthenticatedUserId } from "../http/auth";
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
    const userId = getAuthenticatedUserId(c);
    return c.json(await service.getSession(userId));
  });

  app.post("/demo/reset", async (c) => {
    const userId = getAuthenticatedUserId(c);
    return c.json(await service.resetDemo(userId));
  });

  app.post("/plans", async (c) => {
    const userId = getAuthenticatedUserId(c);
    const query = parseQuery(await readJsonBody(c.req.raw));
    return runService(() => service.createPlan(userId, query), (plan) =>
      c.json(plan),
    );
  });

  app.get("/plans/current", async (c) => {
    const userId = getAuthenticatedUserId(c);
    const lineageId = parseRequiredId(c.req.query("lineageId"), "lineageId");
    const plan = await service.getCurrentPlan(userId, lineageId);
    if (!plan) {
      throw new HTTPException(404, { message: "no current plan for lineage" });
    }
    return c.json(plan);
  });

  app.get("/plans/:planId", async (c) => {
    const userId = getAuthenticatedUserId(c);
    const plan = await service.getPlanById(userId, c.req.param("planId"));
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

async function runService<T>(
  call: () => Promise<T>,
  respond: (value: T) => Response,
): Promise<Response> {
  try {
    return respond(await call());
  } catch (error) {
    if (error instanceof PlanServiceError) {
      throw new HTTPException(HTTP_STATUS_BY_ERROR_CODE[error.code], {
        message: error.message,
      });
    }
    throw error;
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HTTPException(400, { message: "invalid JSON body" });
  }
}

function parseQuery(body: unknown): string {
  const query = asRecord(body).query;
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new HTTPException(400, { message: "query must be a non-empty string" });
  }
  return query.trim();
}

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
    amountPoints <= 0
  ) {
    throw new HTTPException(400, {
      message: "amountPoints must be a positive integer",
    });
  }

  return { sourceProgramId, destProgramId, amountPoints };
}

function parseRequiredId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HTTPException(400, { message: `${field} is required` });
  }
  return value.trim();
}

function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null) {
    throw new HTTPException(400, { message: "request body must be an object" });
  }
  return body as Record<string, unknown>;
}
