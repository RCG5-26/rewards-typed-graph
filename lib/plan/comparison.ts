/**
 * Shared formatting helpers for the plan console.
 *
 * Note: this module previously also derived a synthetic architecture token
 * comparison (`deriveComparison`) for the onboarding console. That was removed —
 * the typed-graph orchestrator plans via deterministic specialists with no LLM
 * call (0 model tokens), and fabricating a non-zero figure misrepresented it.
 * The real, measured baseline token costs live on the live comparison
 * (`/test-wallets`) and benchmark (`/benchmark`) pages.
 */

/**
 * Whole-dollar label from cents; em dash when zero so a not-yet-resolved plan
 * value never renders as a misleading "$0".
 */
export const dollars = (cents: number) =>
  cents === 0 ? "—" : `$${Math.round(cents / 100).toLocaleString("en-US")}`;
