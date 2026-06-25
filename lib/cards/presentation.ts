/**
 * Card-face presentation map.
 *
 * The seed (`credit_cards`) carries no visual fields — face gradients and accent
 * hexes are pure presentation, so they live here keyed by seed slug rather than
 * in the schema. This is a deliberate, scoped hardcoded-hex exception (same
 * carve-out rationale as `components/GPFreeHero.tsx`); everywhere else the
 * onboarding UI references design-system tokens. When a card has no entry we
 * fall back to a neutral ink face so an unknown seed row still renders.
 */

export interface CardFace {
  face: string;
  accent: string;
}

const FALLBACK: CardFace = {
  face: "linear-gradient(150deg, #24262e, #14161c)",
  accent: "#8e8e96",
};

/** Keyed by `credit_cards.slug` from the demo seed. */
export const CARD_FACES: Record<string, CardFace> = {
  "card:chase_sapphire_reserve": {
    face: "linear-gradient(150deg, #1d2540, #0f1424)",
    accent: "#7d97ff",
  },
  "card:chase_sapphire_preferred": {
    face: "linear-gradient(150deg, #20305a, #131c34)",
    accent: "#5b8def",
  },
  "card:chase_freedom_unlimited": {
    face: "linear-gradient(150deg, #16313a, #0d1c22)",
    accent: "#4fb6a8",
  },
  "card:world_of_hyatt": {
    face: "linear-gradient(150deg, #2a2140, #181029)",
    accent: "#a98bd6",
  },
  "card:united_explorer": {
    face: "linear-gradient(150deg, #182a4a, #0e1830)",
    accent: "#6aa6e8",
  },
};

export function faceForSlug(slug: string): CardFace {
  return CARD_FACES[slug] ?? FALLBACK;
}
