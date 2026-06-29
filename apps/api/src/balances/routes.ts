import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { type AuthEnv, getAuthenticatedUserId } from "../http/auth";

/** One program balance captured from the onboarding wallet picker. */
export interface BalanceInput {
  programId: string;
  points: number;
}

/**
 * Wallet balances HTTP surface: the onboarding wallet picker collects how many
 * points the signed-in user holds per program and submits them here.
 *
 * The route validates the payload against the authenticated user and echoes the
 * normalized per-program balances it received. It carries no `PlanService`
 * dependency — capturing balances is a self-contained, side-effect-light write
 * (the personal graph is fixture/Postgres-backed and read-only elsewhere), so
 * the route stays a thin, independently testable Hono app mounted in `app.ts`.
 */
export function createBalancesRoutes() {
  const app = new Hono<AuthEnv>();

  app.post("/balances", async (c) => {
    const userId = getAuthenticatedUserId(c);
    const balances = parseBalances(await readJsonBody(c.req.raw));
    return c.json({ userId, balances });
  });

  return app;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new HTTPException(400, { message: "invalid JSON body" });
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new HTTPException(400, { message: "request body must be an object" });
  }
  return parsed as Record<string, unknown>;
}

/**
 * Validate `{ balances: [{ programId, points }] }`. Points must be a
 * non-negative safe integer (0 means "I hold none"); a single program may not
 * appear twice so the captured balances stay unambiguous.
 */
function parseBalances(body: Record<string, unknown>): BalanceInput[] {
  const raw = body.balances;
  if (!Array.isArray(raw)) {
    throw new HTTPException(400, { message: "balances must be an array" });
  }

  const seen = new Set<string>();
  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new HTTPException(400, { message: `balances[${index}] must be an object` });
    }
    const { programId, points } = entry as Record<string, unknown>;
    if (typeof programId !== "string" || programId.trim().length === 0) {
      throw new HTTPException(400, {
        message: `balances[${index}].programId must be a non-empty string`,
      });
    }
    const id = programId.trim();
    if (seen.has(id)) {
      throw new HTTPException(400, { message: `duplicate programId: ${id}` });
    }
    seen.add(id);
    if (
      typeof points !== "number" ||
      !Number.isInteger(points) ||
      !Number.isSafeInteger(points) ||
      points < 0
    ) {
      throw new HTTPException(400, {
        message: `balances[${index}].points must be a non-negative safe integer`,
      });
    }
    return { programId: id, points };
  });
}
