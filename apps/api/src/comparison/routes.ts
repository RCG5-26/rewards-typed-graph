/**
 * Demo architecture-comparison HTTP surface (freeze Step 7):
 *   POST /demo/architecture-comparison  { walletId, query? }
 *
 * Only approved wallet ids are accepted; facts are resolved server-side so no
 * client can inject balances or award gold. The query defaults to the canonical
 * query, guaranteeing all three architectures receive it verbatim. The route is
 * unauthenticated by design — it runs a fixed demo persona, not the caller's
 * wallet.
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { type AuthEnv } from "../http/auth";
import { APPROVED_WALLET_IDS, CANONICAL_QUERY, isApprovedWalletId } from "./canonical-wallet";
import { type ComparisonDeps, runArchitectureComparison } from "./run-comparison";

export function createComparisonRoutes(deps: ComparisonDeps) {
  const app = new Hono<AuthEnv>();

  app.post("/demo/architecture-comparison", async (c) => {
    const body = await readJsonBody(c.req.raw);
    const walletId = parseWalletId(body);
    const query = parseQuery(body);
    const response = await runArchitectureComparison(walletId, query, deps);
    return c.json(response);
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

/** Optional; defaults to the canonical query so every variant gets it verbatim. */
function parseQuery(body: Record<string, unknown>): string {
  const query = body.query;
  if (query === undefined) return CANONICAL_QUERY;
  if (typeof query !== "string" || query.trim().length === 0) {
    throw new HTTPException(400, { message: "query must be a non-empty string when provided" });
  }
  return query.trim();
}
