import "server-only";

import type {
  ApiBalanceTransferResponse,
  ApiPlan,
  ApiSessionResponse,
  ApiTransferParams,
} from "./types";
import { ApiError } from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

function baseUrl(): string {
  const url = process.env.API_BASE_URL;
  if (!url) {
    throw new ApiError({
      kind: "misconfigured",
      message: "API_BASE_URL is not set — the web service cannot reach the Hono API.",
    });
  }
  return url.replace(/\/$/, "");
}

function fetchTimeoutMs(): number {
  const raw = process.env.API_FETCH_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

interface FetchOpts {
  method: "GET" | "POST";
  body?: unknown;
  token: string;
}

export async function apiFetch<T>(path: string, opts: FetchOpts): Promise<T> {
  const url = `${baseUrl()}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs());
  try {
    const res = await fetch(url, {
      method: opts.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.token}`,
      },
      signal: controller.signal,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });

    if (!res.ok) {
      if (res.status === 401) {
        throw new ApiError({ kind: "not-signed-in", status: 401 });
      }
      if (res.status === 403) {
        throw new ApiError({ kind: "unprovisioned", status: 403 });
      }
      throw new ApiError({
        kind: "server-error",
        status: res.status,
        message: `Hono API responded ${res.status}`,
      });
    }

    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (controller.signal.aborted || (error as Error).name === "AbortError") {
      throw new ApiError({
        kind: "server-error",
        status: 504,
        message: "Hono API request timed out",
      });
    }
    throw new ApiError({
      kind: "server-error",
      status: 502,
      message: "Hono API request failed",
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function getSession(token: string): Promise<ApiSessionResponse> {
  return apiFetch<ApiSessionResponse>("/session", { method: "GET", token });
}

export async function createPlan(query: string, token: string): Promise<ApiPlan> {
  return apiFetch<ApiPlan>("/plans", { method: "POST", body: { query }, token });
}

export async function getPlan(planId: string, token: string): Promise<ApiPlan> {
  return apiFetch<ApiPlan>(`/plans/${planId}`, { method: "GET", token });
}

export async function balanceTransfer(
  params: ApiTransferParams,
  token: string,
): Promise<ApiBalanceTransferResponse> {
  return apiFetch<ApiBalanceTransferResponse>("/balance-transfer", {
    method: "POST",
    body: params,
    token,
  });
}

export async function demoReset(token: string): Promise<ApiSessionResponse> {
  return apiFetch<ApiSessionResponse>("/demo/reset", { method: "POST", token });
}

// Re-export for convenience in tests
export { ApiError } from "./types";
