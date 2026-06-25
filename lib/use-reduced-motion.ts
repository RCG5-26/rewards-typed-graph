import { useEffect, useState } from "react";

/**
 * Tracks `prefers-reduced-motion: reduce`. Used to disable JS-driven motion
 * (the card 3D tilt and the number count-up); CSS animations are neutralized
 * globally via the media query in `globals.css`.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
