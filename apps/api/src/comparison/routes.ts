/**
 * Demo architecture-comparison HTTP surface (freeze Step 7):
 *   POST /demo/architecture-comparison  { walletId, query? }
 *
 * Only approved wallet ids are accepted; facts are resolved server-side so no
 * client can inject balances or award gold. The query is fixed to the canonical
 * query: an absent query resolves to it, the exact canonical string is accepted,
 * and anything else is a 400 (review Fix 5). This keeps the response `query`
 * honest — it always equals what every architecture actually received (the
 * baselines read the canonical query from the cases file; the graph receives it
 * verbatim). The route is unauthenticated by design — it runs a fixed demo
 * persona, not the caller's wallet.
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { type AuthEnv } from "../http/auth";
import type { PlanService } from "../plans/service";
import {
  APPROVED_WALLET_IDS,
  CANONICAL_QUERY,
  getCanonicalWallet,
  isApprovedWalletId,
} from "./canonical-wallet";
import { type ComparisonDeps, runArchitectureComparison } from "./run-comparison";
import { runDemoSimulateTransfer } from "./simulate-transfer";

export function createComparisonRoutes(deps: ComparisonDeps) {
  const app = new Hono<AuthEnv>();

  // Public canonical facts the Test Wallets page shows before any run. These are
  // the same facts supplied to the agents — never private gold — so the UI never
  // hard-codes balances of its own.
  app.get("/demo/test-wallets", (c) => {
    const wallets = APPROVED_WALLET_IDS.map((id) => getCanonicalWallet(id)).filter(
      (w): w is NonNullable<typeof w> => w !== undefined,
    );
    return c.json({ wallets });
  });

  app.post("/demo/architecture-comparison", async (c) => {
    const body = await readJsonBody(c.req.raw);
    const walletId = parseWalletId(body);
    const query = parseQuery(body);
    const response = await runArchitectureComparison(walletId, query, deps);
    return c.json(response);
  });

  app.post("/demo/simulate-transfer", async (c) => {
    const body = await readJsonBody(c.req.raw);
    const walletId = parseWalletId(body);
    const replanService = deps.replanService ?? (deps.graphService as PlanService);
    const idempotencyKey = parseOptionalIdempotencyKey(body);
    try {
      const response = await runDemoSimulateTransfer(walletId, {
        replanService,
        planEngine: deps.planEngine,
      }, idempotencyKey);
      return c.json(response);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("PLAN_ENGINE=") || message.includes("requires PLAN_ENGINE")) {
        throw new HTTPException(503, { message });
      }
      throw new HTTPException(400, { message });
    }
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

function parseWalletId(body: Record<string, unknown>) {
  const walletId = body.walletId;
  if (!isApprovedWalletId(walletId)) {
    throw new HTTPException(400, {
      message: `walletId must be one of: ${APPROVED_WALLET_IDS.join(", ")}`,
    });
  }
  return walletId;
}

/**
 * The demo runs one fixed scenario, so the only accepted query is the canonical
 * one. Absent → canonical; exact canonical → accepted; anything else → 400. This
 * guarantees the response `query` matches what all three architectures ran on —
 * the demo does not support arbitrary queries (review Fix 5).
 */
function parseQuery(body: Record<string, unknown>): string {
  const query = body.query;
  if (query === undefined) return CANONICAL_QUERY;
  if (typeof query === "string" && query.trim() === CANONICAL_QUERY) {
    return CANONICAL_QUERY;
  }
  throw new HTTPException(400, {
    message: "query is fixed for this demo; omit it or send the exact canonical query",
  });
}

function parseOptionalIdempotencyKey(body: Record<string, unknown>): string | undefined {
  const key = body.idempotencyKey;
  if (key === undefined) return undefined;
  if (typeof key !== "string" || key.trim().length === 0) {
    throw new HTTPException(400, { message: "idempotencyKey must be a non-empty string when provided" });
  }
  return key.trim();
}
