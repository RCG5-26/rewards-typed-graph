import "server-only";

import type {
  ArchitectureComparisonResponse,
  DemoSimulateTransferResponse,
  TestWalletsResponse,
} from "./types";

/**
 * Server-only client for the public demo comparison endpoints. These Hono routes
 * are unauthenticated (a fixed demo persona), so unlike `lib/api/client.ts` no
 * Bearer token is sent. The comparison runs three architectures (one live graph
 * call + two LLM subprocesses), so the timeout is generous.
 *
 * This proxy timeout must sit at or above the slowest backend architecture bound
 * plus response overhead (review Fix 4). The backend bounds live in
 * `apps/api/src/comparison/timeouts.ts` (graph 60s, single/chat 120s); the
 * matching floor (135s) is asserted in `client.test.ts`. The repo has no shared
 * TS workspace (ADR 0007), so the value is mirrored here as a literal.
 */
export const COMPARISON_PROXY_TIMEOUT_MS = 135_000;

function baseUrl(): string {
  const url = process.env.API_BASE_URL;
  if (!url) {
    throw new Error("API_BASE_URL is not set — the web service cannot reach the Hono API.");
  }
  return url.replace(/\/$/, "");
}

async function publicFetch<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Hono API responded ${res.status} for ${path}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getTestWallets(): Promise<TestWalletsResponse> {
  return publicFetch<TestWalletsResponse>("/demo/test-wallets", { method: "GET" }, 15_000);
}

export async function runArchitectureComparison(
  walletId: string,
): Promise<ArchitectureComparisonResponse> {
  // No query is sent: the demo runs one fixed canonical query (review Fix 5).
  return publicFetch<ArchitectureComparisonResponse>(
    "/demo/architecture-comparison",
    { method: "POST", body: JSON.stringify({ walletId }) },
    COMPARISON_PROXY_TIMEOUT_MS,
  );
}

/** Apply the canonical hero-demo transfer and return revision 2 for the graph card. */
export async function simulateDemoTransfer(
  walletId: string,
  idempotencyKey?: string,
): Promise<DemoSimulateTransferResponse> {
  return publicFetch<DemoSimulateTransferResponse>(
    "/demo/simulate-transfer",
    {
      method: "POST",
      body: JSON.stringify({
        walletId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      }),
    },
    60_000,
  );
}
