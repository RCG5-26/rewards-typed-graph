import "server-only";

import type { ArchitectureComparisonResponse, TestWalletsResponse } from "./types";

/**
 * Server-only client for the public demo comparison endpoints. These Hono routes
 * are unauthenticated (a fixed demo persona), so unlike `lib/api/client.ts` no
 * Bearer token is sent. The comparison runs three architectures (one live graph
 * call + two LLM subprocesses), so the timeout is generous.
 */

const COMPARISON_TIMEOUT_MS = 90_000;

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
  query?: string,
): Promise<ArchitectureComparisonResponse> {
  return publicFetch<ArchitectureComparisonResponse>(
    "/demo/architecture-comparison",
    { method: "POST", body: JSON.stringify({ walletId, ...(query ? { query } : {}) }) },
    COMPARISON_TIMEOUT_MS,
  );
}
