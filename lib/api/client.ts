import "server-only";

import type {
  ApiBalanceTransferResponse,
  ApiPlan,
  ApiSessionResponse,
  ApiTransferParams,
} from "./types";
import { ApiError } from "./types";

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

interface FetchOpts {
  method: "GET" | "POST";
  body?: unknown;
  token: string;
}

export async function apiFetch<T>(path: string, opts: FetchOpts): Promise<T> {
  const url = `${baseUrl()}${path}`;
  const res = await fetch(url, {
    method: opts.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.token}`,
    },
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

  return res.json() as Promise<T>;
}

export async function getSession(token: string): Promise<ApiSessionResponse> {
  return apiFetch<ApiSessionResponse>("/session", { method: "GET", token });
}

export async function createPlan(query: string, token: string): Promise<ApiPlan> {
  return apiFetch<ApiPlan>("/plans", { method: "POST", body: { query }, token });
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
