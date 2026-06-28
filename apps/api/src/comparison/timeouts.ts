/**
 * Explicit per-architecture timeout bounds for the three-way comparison
 * (review Fix 4). Every architecture runs under a bounded timeout so a single
 * slow/hung backend returns as one `failed` (timed-out) result via
 * `Promise.allSettled` rather than stalling or failing the whole comparison.
 *
 * The HTTP/proxy layer must allow at least the slowest backend bound plus
 * response overhead — see {@link SLOWEST_ARCHITECTURE_TIMEOUT_MS} and the web
 * proxy constant in `lib/comparison/client.ts` (kept in lock-step by
 * `lib/comparison/client.test.ts`, since the repo has no shared TS workspace).
 */

/** Live graph orchestrator (DB snapshot + specialists + controlled writes). */
export const GRAPH_TIMEOUT_MS = 60_000;

/** Single-agent Python LLM baseline (one model call). */
export const SINGLE_AGENT_TIMEOUT_MS = 120_000;

/** Free-text multi-agent chat-crew Python LLM baseline (several model calls). */
export const CHAT_CREW_TIMEOUT_MS = 120_000;

/** The slowest single architecture bound — the floor for any wrapping layer. */
export const SLOWEST_ARCHITECTURE_TIMEOUT_MS = Math.max(
  GRAPH_TIMEOUT_MS,
  SINGLE_AGENT_TIMEOUT_MS,
  CHAT_CREW_TIMEOUT_MS,
);

/**
 * Minimum timeout the HTTP/proxy layer must allow: the slowest backend plus
 * response/serialization overhead. The web proxy sets its own constant to a
 * value at or above this floor.
 */
export const PROXY_OVERHEAD_MS = 15_000;
export const MIN_PROXY_TIMEOUT_MS = SLOWEST_ARCHITECTURE_TIMEOUT_MS + PROXY_OVERHEAD_MS;
