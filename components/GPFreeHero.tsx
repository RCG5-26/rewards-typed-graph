"use client";

import { useRef } from "react";
import { CSS, FM, useGpxCinema, type GPFreeHeroProps } from "./gpfree/cinema";
import HeroStage from "./gpfree/HeroStage";
import HowItWorks from "./gpfree/HowItWorks";
import SiteFooter from "./gpfree/SiteFooter";

export type { ScrollLength, GPFreeHeroProps } from "./gpfree/cinema";

/**
 * GPFree — scroll-driven cinematic hero + how-it-works + footer.
 *
 * Faithful React port of the design handoff. Composition only: the single
 * scroll engine lives in `useGpxCinema` (components/gpfree/cinema) and drives
 * the presentational sections (HeroStage / HowItWorks / SiteFooter) through
 * `data-*` hooks on this shared root.
 */
export default function GPFreeHero({
  scrollLength = "standard",
  showPoints = true,
  showGrain = true,
}: GPFreeHeroProps = {}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useGpxCinema(rootRef, { scrollLength, showPoints, showGrain });

  return (
    <div
      id="gpx-hero"
      ref={rootRef}
      style={{ background: "#0C0A07", color: "#F2EADD", fontFamily: FM }}
    >
      <style>{CSS}</style>
      <HeroStage scrollLength={scrollLength} showPoints={showPoints} showGrain={showGrain} />
      <HowItWorks />
      <SiteFooter />
    </div>
  );
}
