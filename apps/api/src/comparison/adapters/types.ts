/**
 * Shared adapter input. Every adapter receives the same canonical facts and the
 * same query, invokes one real architecture, and returns an
 * {@link ArchitectureComparisonResult} WITHOUT an `evaluation` field — the
 * comparison endpoint applies the single deterministic evaluator to all three so
 * no adapter can score itself.
 */

import type { CanonicalWalletFacts } from "../canonical-wallet";

export interface AdapterInput {
  facts: CanonicalWalletFacts;
  /** Defaults to the canonical query carried by `facts.query`. */
  query?: string;
}

export function resolveQuery(input: AdapterInput): string {
  return input.query ?? input.facts.query;
}
