/**
 * Architecture comparison derived from the live plan run (shared by the
 * baselines + benchmark tabs).
 *
 * What is genuinely live: the typed-graph **plan value** and the **token cost**,
 * the latter scaled off the real number of `graph_mutations` the run streamed —
 * so the comparison moves with the actual plan, not a static fixture. The
 * baseline (CrewAI / single-agent) figures are *derived* from those live numbers
 * via the documented model below (a baseline that hallucinates a 1.25:1 ratio
 * overstates value; message-passing / re-fetching inflate tokens). They are
 * illustrative projections of the live run, not measurements of a real CrewAI
 * execution — there is no second architecture actually running here.
 */

export interface LiveMetrics {
  /** The typed-graph plan value, in cents (live). */
  planValueCents: number;
  /** Count of real `graph_mutations` rows the run streamed (live). */
  opCount: number;
  /** True once a balance invalidation actually fired a re-plan this session. */
  invalidationCaught: boolean;
  /** Current plan revision (1 = initial, 2 = after a replan). */
  revision: number;
}

// ── Derivation model (documented illustrative projection) ──
const VALUE = {
  /** CrewAI hallucinates a 1.25:1 transfer ratio → overstates the award value. */
  crewaiOverstate: 1.25,
  /** Single agent loses the goal mid-context → settles for a weaker redemption. */
  singleUndershoot: 0.7,
};
const TOKENS = {
  /** Fixed orchestration overhead before any mutation. */
  base: 1200,
  /** Marginal tokens per streamed graph mutation. */
  perOp: 350,
  /** Free-text JSON message-passing overhead between agents. */
  crewaiMult: 2.8,
  /** Re-fetching tool results with no shared state to read. */
  singleMult: 2.0,
};

export interface ArchDerived {
  valueCents: number;
  /** Estimated tokens for the run. */
  tokens: number;
}

export interface Comparison {
  typed: ArchDerived;
  crewai: ArchDerived;
  single: ArchDerived;
}

export function deriveComparison(m: LiveMetrics): Comparison {
  const typedTokens = TOKENS.base + Math.max(0, m.opCount) * TOKENS.perOp;
  return {
    typed: { valueCents: m.planValueCents, tokens: typedTokens },
    crewai: {
      valueCents: Math.round(m.planValueCents * VALUE.crewaiOverstate),
      tokens: Math.round(typedTokens * TOKENS.crewaiMult),
    },
    single: {
      valueCents: Math.round(m.planValueCents * VALUE.singleUndershoot),
      tokens: Math.round(typedTokens * TOKENS.singleMult),
    },
  };
}

/** Compact token label, e.g. 4350 → "4.4k". */
export const fmtTokens = (n: number) => `${(n / 1000).toFixed(1)}k`;
