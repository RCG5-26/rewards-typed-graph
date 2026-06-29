// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

import GPFreeHero from "./GPFreeHero";

// The hero mounts a large animation effect (pointer tilt, reveal observers,
// the stepper). jsdom lacks these APIs, so stub the ones the effect constructs
// unconditionally — we only care that the CTA links render to the right target.
beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true, // reduced-motion → skips the rAF-driven counter path
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", IO);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("GPFreeHero CTAs", () => {
  it("points both 'start optimizing' CTAs at /onboarding (not /test-wallets)", () => {
    const { container } = render(<GPFreeHero />);
    const ctas = Array.from(container.querySelectorAll("a.cta"));

    expect(ctas.length).toBe(2);
    for (const cta of ctas) {
      expect(cta.getAttribute("href")).toBe("/onboarding");
    }
    // No CTA should regress back to the old comparison entry point.
    expect(container.innerHTML).not.toContain('href="/test-wallets"');
  });
});
