import "server-only";

import type {
  ApiBalanceInput,
  ApiBalanceTransferResponse,
  ApiPlan,
  ApiSessionResponse,
  ApiSubmitBalancesResponse,
  ApiTransferParams,
} from "./types";
import { ApiError } from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Floor for plan create / balance-transfer proxy calls. Must sit above the live
 * graph orchestrator bound (60s in `apps/api/src/comparison/timeouts.ts`) plus
 * response overhead — mirrored here because the repo has no shared TS workspace.
 */
export const PLAN_PROXY_TIMEOUT_MS = 75_000;

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
  /** Per-call override; defaults to {@link fetchTimeoutMs}. */
  timeoutMs?: number;
}

function planOperationTimeoutMs(): number {
  return Math.max(fetchTimeoutMs(), PLAN_PROXY_TIMEOUT_MS);
}

export async function apiFetch<T>(path: string, opts: FetchOpts): Promise<T> {
  const url = `${baseUrl()}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? fetchTimeoutMs(),
  );
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
      // Surface the upstream `{ error }` message (e.g. a Hono validation reason
      // like "balances[0].points must be a non-negative safe integer") instead
      // of masking it with a generic status string. Best-effort: falls back to
      // the generic message when the body is absent or not JSON.
      const serverMessage = await res
        .json()
        .then((body) =>
          body && typeof (body as { error?: unknown }).error === "string"
            ? (body as { error: string }).error
            : undefined,
        )
        .catch(() => undefined);
      throw new ApiError({
        kind: "server-error",
        status: res.status,
        message: serverMessage ?? `Hono API responded ${res.status}`,
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

export async function createPlan(
  query: string,
  token: string,
  cardSlugs?: string[],
): Promise<ApiPlan> {
  const body: Record<string, unknown> = { query };
  if (cardSlugs && cardSlugs.length > 0) body.cardSlugs = cardSlugs;
  return apiFetch<ApiPlan>("/plans", {
    method: "POST",
    body,
    token,
    timeoutMs: planOperationTimeoutMs(),
  });
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
    timeoutMs: planOperationTimeoutMs(),
  });
}

/**
 * Submit the per-program point balances the user entered in the onboarding
 * wallet picker. The API validates and echoes the normalized balances back.
 */
export async function submitBalances(
  balances: ApiBalanceInput[],
  token: string,
): Promise<ApiSubmitBalancesResponse> {
  return apiFetch<ApiSubmitBalancesResponse>("/balances", {
    method: "POST",
    body: { balances },
    token,
  });
}

export async function demoReset(token: string): Promise<ApiSessionResponse> {
  return apiFetch<ApiSessionResponse>("/demo/reset", { method: "POST", token });
}

// Re-export for convenience in tests
export { ApiError } from "./types";
