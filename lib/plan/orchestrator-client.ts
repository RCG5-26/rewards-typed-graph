import "server-only";

import { auth } from "@clerk/nextjs/server";

/**
 * HTTP client for the real orchestrator backend (the Hono API in `apps/api`,
 * which spawns the Python `hero_bridge.py` seam over Postgres). This is the
 * "#3/#4" wiring: when `API_BASE_URL` (or `NEXT_PUBLIC_API_BASE_URL`) is set,
 * the plan routes call the live `POST /plans` / `POST /balance-transfer`
 * endpoints instead of the deterministic fixture builder. The caller is
 * responsible for falling back to the fixture builder when this throws (API
 * unconfigured/unreachable) so the demo keeps working with no backend running.
 *
 * The Clerk session token is forwarded as a bearer header; the API resolves the
 * `userId` itself from that token (or its `AUTH_DEV_USER_ID` bypass in dev), so
 * we never send a user id over the wire.
 */

// ── Local mirror of `apps/api/src/plans/types.ts` (no cross-package import) ──
export interface PlanStepView {
  order: number;
  type: string;
  summary: string;
  reasoning: string;
  status: "proposed" | "current" | "stale" | "superseded";
  dependsOn: string[];
}

export interface PlanView {
  planId: string;
  planLineageId: string;
  revisionNumber: number;
  status: "generating" | "current" | "stale" | "superseded" | "failed";
  query: string;
  summary: string | null;
  steps: PlanStepView[];
}

export interface BalanceTransferInput {
  sourceProgramId: string;
  destProgramId: string;
  amountPoints: number;
  idempotencyKey?: string;
}

export interface BalanceTransferResult {
  planLineageId: string;
  staledPlanId: string | null;
  replanJobId: string | null;
  currentPlan: PlanView;
}

/** One real `graph_mutations` row (mirror of `apps/api/src/mutations/events.ts`). */
export interface MutationEvent {
  event_id: string;
  mutation_txn_id: string;
  user_id: string;
  plan_lineage_id: string | null;
  plan_id: string | null;
  agent_run_id: string | null;
  mutation_type: string;
  target_table: string | null;
  target_node_id: string | null;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  committed_at: string;
}

const TIMEOUT_MS = 30_000;

/** The configured API base URL, or null when no real backend is wired. */
function apiBaseUrl(): string | null {
  const base = process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  return base && base.trim() ? base.trim().replace(/\/+$/, "") : null;
}

/** True when a real orchestrator backend is configured (else use the fixture). */
export function isOrchestratorEnabled(): boolean {
  return apiBaseUrl() !== null;
}

/** Forward the signed-in Clerk session token so the API can resolve the user. */
async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { getToken } = await auth();
    const token = await getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const base = apiBaseUrl();
  if (!base) throw new Error("orchestrator API base URL not configured");
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(await authHeaders()),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 500);
    throw new Error(`orchestrator ${method} ${path} failed: ${res.status} ${detail}`.trim());
  }
  return (await res.json()) as T;
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>("POST", path, body);
}

/** Create revision 1 of a plan from a natural-language query (real backend). */
export function createPlanViaOrchestrator(query: string): Promise<PlanView> {
  return postJson<PlanView>("/plans", { query });
}

/** Transfer points and re-plan in Postgres, returning the new current revision. */
export function transferBalanceViaOrchestrator(
  input: BalanceTransferInput,
): Promise<BalanceTransferResult> {
  return postJson<BalanceTransferResult>("/balance-transfer", input);
}

/** Page the real `graph_mutations` log for the signed-in user, after a cursor. */
export function fetchMutationsViaOrchestrator(after = 0): Promise<MutationEvent[]> {
  return request<MutationEvent[]>("GET", `/mutations?after=${encodeURIComponent(String(after))}`);
}

/**
 * Highest mutation cursor currently visible to the user — captured *before* a
 * write so we can fetch exactly the rows that write produces (`after=cursor`).
 * Best-effort: returns 0 when the backend is unreachable so the caller falls
 * back to the derived log.
 */
export async function latestMutationCursor(): Promise<number> {
  try {
    const events = await fetchMutationsViaOrchestrator(0);
    return events.reduce((max, e) => Math.max(max, Number(e.event_id) || 0), 0);
  } catch {
    return 0;
  }
}
