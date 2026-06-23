import { useEffect, type CSSProperties, type RefObject } from "react";

/**
 * GPFree cinematic hero — shared constants, styles, and the scroll engine.
 *
 * The hero is "one sticky stage + N absolutely-stacked layers whose
 * opacity/transform are functions of a single scroll-progress value p∈[0,1]".
 * Presentation lives in the HeroStage / HowItWorks / SiteFooter components;
 * all imperative wiring (scroll mapping, typewriters, stepper, pointer-reactive
 * glow/parallax, magnetic CTAs) lives in `useGpxCinema` below and drives the
 * markup via `data-*` hooks.
 */

// Design-system font roles: display (headings), mono (labels/code), sans (body).
export const FB = "var(--font-display)";
export const FM = "var(--font-mono)";
export const FS = "var(--font-sans)";

export const FRAMES = [
  "/assets/frame-001.webp",
  "/assets/frame-050.webp",
  "/assets/frame-100.webp",
  "/assets/frame-150.webp",
  "/assets/frame-200.webp",
  "/assets/frame-250.webp",
];

/** Total scroll-track height per pacing preset (mirrors the design's prop). */
export type ScrollLength = "relaxed" | "standard" | "snappy";
export const LEN_MAP: Record<ScrollLength, string> = {
  relaxed: "1000vh",
  standard: "760vh",
  snappy: "560vh",
};

export interface GPFreeHeroProps {
  /** Length of the scroll-driven hero track. Default "standard" (760vh). */
  scrollLength?: ScrollLength;
  /** Show the floating "+100,000" point bursts. Default true. */
  showPoints?: boolean;
  /** Show the film-grain overlay. Default true. */
  showGrain?: boolean;
}

/** Shared pill-CTA styling. Per-CTA color/background/padding override it. */
export const CTA_PILL: CSSProperties = {
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--gap-xs)",
  fontFamily: FS,
  fontSize: "var(--text-sm)",
  fontWeight: "var(--weight-semibold)" as unknown as number,
  letterSpacing: "var(--tracking-wide)",
  textTransform: "uppercase",
  borderRadius: "var(--radius-full)",
  transition: "var(--transition-color)",
};

export const beatHeadStyle: CSSProperties = {
  margin: 0,
  fontFamily: FB,
  fontWeight: "var(--weight-light)" as unknown as number,
  fontSize: "clamp(var(--text-3xl), 4.6vw, var(--text-5xl))",
  lineHeight: "var(--leading-tight)",
  letterSpacing: "var(--tracking-tight)",
  color: "var(--color-text-primary)",
};

// Beat lines start hidden so they reveal exactly once (driven by the scroll
// engine). Without this they'd render visible in the initial HTML, get snapped
// hidden for the intro, then reveal — a visible→hidden→visible flash on load.
export const lineTr: CSSProperties = {
  opacity: 0,
  transform: "translateY(var(--space-6))",
  transition:
    "opacity var(--duration-base) var(--ease-soft), transform var(--duration-slow) var(--spring-settle)",
};

// `inert` on beats that begin hidden keeps their CTAs out of the focus order
// before the scroll engine takes over (it then toggles inert per visibility).
export const initiallyHidden = { inert: "" } as unknown as React.HTMLAttributes<HTMLDivElement>;

export const kicker: CSSProperties = {
  fontFamily: FS,
  fontSize: "var(--text-2xs)",
  fontWeight: "var(--weight-semibold)" as unknown as number,
  letterSpacing: "var(--tracking-wider)",
  textTransform: "uppercase",
  color: "var(--color-accent-text)",
};

// [top%, left%, fontSize, blur, glowAlpha, durationS, delayS]
export const POINTS: [string, string, number, number, number, number, number][] = [
  ["20%", "58%", 24, 18, 0.8, 4.6, 0],
  ["38%", "75%", 18, 16, 0.75, 5.2, 0.8],
  ["62%", "64%", 21, 18, 0.8, 4.2, 1.6],
  ["30%", "88%", 15, 14, 0.7, 5.8, 0.4],
  ["74%", "81%", 16, 15, 0.7, 4.8, 2.2],
  ["50%", "52%", 23, 18, 0.8, 5, 1.2],
  ["14%", "80%", 14, 13, 0.65, 5.4, 2.6],
  ["84%", "58%", 18, 16, 0.75, 4.4, 0.2],
  ["46%", "90%", 19, 16, 0.75, 5.6, 1.9],
  ["67%", "47%", 15, 14, 0.7, 5, 3],
];

export const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export const CSS = `
@keyframes gpxHint { 0%,100% { transform: translateY(0); opacity: 0.55; } 50% { transform: translateY(7px); opacity: 1; } }
@keyframes gpxCaret { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
@keyframes gpxCurtain { from { opacity: 1; } to { opacity: 0; } }
@keyframes gpxRise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes gpxGlint { 0% { transform: translateX(-160%) rotate(8deg); } 100% { transform: translateX(220%) rotate(8deg); } }
@keyframes gpxFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@keyframes gpxPts { 0% { transform: translateY(14px); opacity: 0; } 25% { opacity: 0.9; } 70% { opacity: 0.7; } 100% { transform: translateY(-22px); opacity: 0; } }

.gpx-cta-ivory:hover { background:var(--color-accent-fg) !important; }
.gpx-cta-ink:hover { background:var(--color-neutral-700) !important; }
.gpx-cta-gilt:hover { background:var(--color-accent-fg) !important; }
.gpx-ghost:hover { background:var(--color-accent-muted) !important; }

@media (max-width: 920px){
  [data-howgrid]{ grid-template-columns:1fr !important; gap:46px !important; }
  #gpx-how{ padding:88px 6vw !important; min-height:auto !important; }
}
@media (max-width: 560px){
  [data-howstage]{ aspect-ratio:1 / 1 !important; }
}
@media (prefers-reduced-motion: reduce){
  #gpx-hero *, #gpx-hero *::before, #gpx-hero *::after { animation-duration:0.001ms !important; animation-iteration-count:1 !important; animation-delay:0ms !important; }
}
`;

/**
 * Wires the cinematic hero behavior onto the subtree under `rootRef`.
 * All elements are addressed by `data-*` hooks, so the markup can be split
 * across presentational components freely as long as it renders inside `root`.
 */
export function useGpxCinema(
  rootRef: RefObject<HTMLDivElement | null>,
  { showPoints }: { scrollLength: ScrollLength; showPoints: boolean; showGrain: boolean },
): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const reduced = !!(
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );

    const track = root.querySelector<HTMLElement>("[data-track]")!;
    const stage = root.querySelector<HTMLElement>("[data-stage]")!;
    const frames = Array.from(root.querySelectorAll<HTMLElement>("[data-frame]"));
    const beats = Array.from(root.querySelectorAll<HTMLElement>("[data-beat]"));
    const beatLines = beats.map((b) =>
      Array.from(b.querySelectorAll<HTMLElement>("[data-line]")),
    );
    const beatCenters = beats.map((b) => parseFloat(b.dataset.center || "0"));
    const barEl = root.querySelector<HTMLElement>("[data-bar]");
    const hintEl = root.querySelector<HTMLElement>("[data-hint]");
    const ptsEl = root.querySelector<HTMLElement>("[data-points]");
    const n = frames.length;

    // ── helpers ────────────────────────────────────────────────────────────
    const findScroller = (el: HTMLElement): HTMLElement => {
      let node = el.parentElement;
      while (node && node !== document.body) {
        const oy = getComputedStyle(node).overflowY;
        if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight + 4)
          return node;
        node = node.parentElement;
      }
      return (document.scrollingElement as HTMLElement) || document.documentElement;
    };
    const scroller = findScroller(track);
    const isWin = () =>
      scroller === document.scrollingElement ||
      scroller === document.documentElement ||
      scroller === document.body;

    const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
    const smooth = (x: number) => {
      x = clamp01(x);
      return x * x * (3 - 2 * x);
    };
    // ease the frame mapping so the card "settles" near each text beat
    const easeP = (p: number) => {
      const A = [0, 0.05, 0.4, 0.7, 0.96, 1];
      let a0 = A[0];
      let a1 = A[A.length - 1];
      for (let i = 0; i < A.length - 1; i++) {
        if (p >= A[i] && p <= A[i + 1]) {
          a0 = A[i];
          a1 = A[i + 1];
          break;
        }
      }
      const span = a1 - a0;
      if (span <= 0) return p;
      const t = clamp01((p - a0) / span);
      const te = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep
      return a0 + te * span;
    };

    const metrics = () => {
      const win = isWin();
      const scTop = win ? 0 : scroller.getBoundingClientRect().top;
      const tr = track.getBoundingClientRect();
      const stageH =
        stage.getBoundingClientRect().height ||
        (win ? window.innerHeight : scroller.clientHeight);
      const span = tr.height - stageH;
      const trackTop = tr.top - scTop;
      return { span, trackTop };
    };

    let intro = true;

    const update = () => {
      const m = metrics();
      let p = m.span > 0 ? -m.trackTop / m.span : 0;
      p = clamp01(p);
      const sf = easeP(p) * (n - 1);

      // soft cross-dissolve through frames
      for (let i = 0; i < n; i++) {
        const f = frames[i];
        const loc = sf - i;
        const d = Math.abs(loc);
        f.style.opacity = String(d >= 1 ? 0 : smooth(1 - d));
        // No zoom: frames stay at their natural cover size (opacity crossfade only).
        f.style.transform = "none";
      }

      // text beats anchored to progress
      const W = 0.13;
      for (let i = 0; i < beats.length; i++) {
        const d = Math.abs(p - beatCenters[i]);
        const o = smooth(1 - d / W);
        const b = beats[i];
        b.style.opacity = String(o);
        const on = o > 0.5 && !(intro && i === 0);
        const interactive = o > 0.55 && on;
        b.style.pointerEvents = interactive ? "auto" : "none";
        // Hidden beats must leave the keyboard focus order + a11y tree, not just
        // ignore pointer events — otherwise their invisible CTAs stay tabbable.
        // `inert` blocks focus, AT, and pointer together; gate it on the same
        // visible state (incl. the intro gate that hides the opener's CTA).
        b.toggleAttribute("inert", !interactive);
        const ls = beatLines[i];
        for (let j = 0; j < ls.length; j++) {
          ls[j].style.opacity = on ? "1" : "0";
          ls[j].style.transform = on ? "translateY(0)" : "translateY(26px)";
        }
      }

      if (barEl) barEl.style.transform = "scaleX(" + p + ")";
      if (hintEl) hintEl.style.opacity = String(Math.max(0, 1 - p * 6));
      if (ptsEl && showPoints)
        ptsEl.style.opacity = String(smooth(1 - Math.abs(p - 0.33) / 0.2));
    };

    // rAF-throttled scroll/resize (capture phase, any scroller)
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        update();
      });
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll, true);

    // ── hero opener typewriter (looping) ────────────────────────────────────
    let tt: ReturnType<typeof setTimeout> | null = null;
    const startTyper = () => {
      const wrap = root.querySelector<HTMLElement>("[data-typer]");
      if (!wrap) return;
      const out = wrap.firstChild as HTMLElement | null;
      if (!out) return;
      if (reduced) {
        out.textContent = "finding award seats across 6 programs";
        return;
      }
      const s = {
        phrases: [
          "finding award seats across 6 programs",
          "turning points into 5-star hotel nights",
          "catching the transfer bonus before it expires",
        ],
        pi: 0,
        ci: 0,
        dir: 1,
      };
      const typer = () => {
        const cur = s.phrases[s.pi];
        if (s.dir === 1) {
          s.ci++;
          out.textContent = cur.slice(0, s.ci);
          if (s.ci >= cur.length) {
            s.dir = -1;
            tt = setTimeout(typer, 1500);
            return;
          }
          tt = setTimeout(typer, 52);
        } else {
          s.ci--;
          out.textContent = cur.slice(0, s.ci);
          if (s.ci <= 0) {
            s.dir = 1;
            s.pi = (s.pi + 1) % s.phrases.length;
            tt = setTimeout(typer, 320);
            return;
          }
          tt = setTimeout(typer, 26);
        }
      };
      typer();
    };

    // ── how-it-works stepper ────────────────────────────────────────────────
    const howSec = root.querySelector<HTMLElement>("#gpx-how");
    const tabs = Array.from(root.querySelectorAll<HTMLElement>("[data-step]"));
    const stepPanels = Array.from(
      root.querySelectorAll<HTMLElement>("[data-steppanel]"),
    );
    const howReveal = howSec
      ? Array.from(howSec.querySelectorAll<HTMLElement>("[data-reveal]"))
      : [];
    const DWELL = 5200;
    let step = 0;
    let inView = false;
    let auto: ReturnType<typeof setInterval> | null = null;
    let stepTT: ReturnType<typeof setTimeout> | null = null;

    const stopStepType = () => {
      if (stepTT) {
        clearTimeout(stepTT);
        stepTT = null;
      }
    };
    const startStepType = () => {
      const wrap = howSec && howSec.querySelector<HTMLElement>("[data-howtyper]");
      if (!wrap) return;
      stopStepType();
      const out = wrap.firstChild as HTMLElement | null;
      if (!out) return;
      const str = "fly to Tokyo in business this fall";
      if (reduced) {
        out.textContent = str;
        return;
      }
      out.textContent = "";
      let ci = 0;
      const stepType = () => {
        if (ci <= str.length) {
          out.textContent = str.slice(0, ci);
          ci++;
          stepTT = setTimeout(stepType, 58);
        }
      };
      stepType();
    };

    const activatePanel = (i: number) => {
      for (let k = 0; k < stepPanels.length; k++) {
        const pnl = stepPanels[k];
        const on = k === i;
        pnl.style.opacity = on ? "1" : "0";
        pnl.style.pointerEvents = on ? "auto" : "none";
        pnl.querySelectorAll<HTMLElement>("[data-anim]").forEach((el) => {
          el.style.opacity = on ? "1" : "0";
          el.style.transform = on
            ? el.dataset.final || "translateY(0)"
            : el.dataset.hidden || "translateY(24px)";
        });
      }
      if (i === 1) startStepType();
      else stopStepType();
    };

    const setStep = (i: number) => {
      step = i;
      for (let k = 0; k < tabs.length; k++) {
        const on = k === i;
        const t = tabs[k];
        t.setAttribute("aria-pressed", on ? "true" : "false");
        t.style.background = on ? "var(--color-accent-muted)" : "transparent";
        t.style.borderLeftColor = on ? "var(--color-accent)" : "transparent";
        const bar = t.querySelector<HTMLElement>("[data-stepbar]");
        const fill = t.querySelector<HTMLElement>("[data-stepfill]");
        if (bar) bar.style.opacity = on ? "1" : "0";
        if (fill) {
          fill.style.transition = "none";
          fill.style.width = "0%";
          if (on) {
            void fill.offsetWidth;
            fill.style.transition = "width " + DWELL + "ms linear";
            fill.style.width = "100%";
          }
        }
      }
      activatePanel(i);
    };

    const stopAuto = () => {
      if (auto) {
        clearInterval(auto);
        auto = null;
      }
    };
    const startAuto = () => {
      stopAuto();
      if (reduced) return;
      auto = setInterval(() => setStep((step + 1) % tabs.length), DWELL);
    };

    const tabClicks = tabs.map((t, i) => {
      const handler = () => {
        setStep(i);
        if (inView) startAuto();
      };
      t.addEventListener("click", handler);
      return handler;
    });
    const onEnter = () => stopAuto();
    const onLeave = () => {
      if (inView) startAuto();
    };
    if (howSec) {
      howSec.addEventListener("mouseenter", onEnter);
      howSec.addEventListener("mouseleave", onLeave);
    }

    let howIO: IntersectionObserver | null = null;
    if (howSec) {
      howIO = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              inView = true;
              howReveal.forEach((el) => {
                el.style.opacity = "1";
                el.style.transform = "translateY(0)";
              });
              setStep(step);
              startAuto();
            } else {
              inView = false;
              stopAuto();
            }
          });
        },
        { threshold: 0.3 },
      );
      howIO.observe(howSec);
    }

    // ── intro ────────────────────────────────────────────────────────────────
    update();
    const introT = setTimeout(() => {
      intro = false;
      startTyper();
      update();
    }, 1250);

    // ── pointer-reactive life: glow + magnetic CTAs ───────────────────────────
    // Depth parallax / idle sway removed: with zero zoom the frames have no
    // overflow to pan into, so any translate would expose their edges.
    // Extra teardown collected here so the cleanup return can dispose the
    // pointer listeners alongside the scroll + stepper teardown.
    const ptrCleanups: Array<() => void> = [];
    const glow = root.querySelector<HTMLElement>("[data-glow]");
    if (!reduced) {
      const onMove = (e: PointerEvent) => {
        if (!glow) return;
        const r = stage.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width;
        const ny = (e.clientY - r.top) / r.height;
        glow.style.setProperty("--gx", (nx * 100).toFixed(1) + "%");
        glow.style.setProperty("--gy", (ny * 100).toFixed(1) + "%");
        glow.style.opacity = "1";
      };
      const onGlowLeave = () => {
        if (glow) glow.style.opacity = "0";
      };
      window.addEventListener("pointermove", onMove);
      stage.addEventListener("pointerleave", onGlowLeave);

      ptrCleanups.push(() => {
        window.removeEventListener("pointermove", onMove);
        stage.removeEventListener("pointerleave", onGlowLeave);
      });

      // magnetic CTAs
      const mags = Array.from(root.querySelectorAll<HTMLElement>("[data-mag]"));
      mags.forEach((a) => {
        a.style.transition =
          "transform 0.25s cubic-bezier(0.2,0.8,0.2,1), background 0.3s ease";
        const mm = (e: PointerEvent) => {
          const r = a.getBoundingClientRect();
          const mx = e.clientX - (r.left + r.width / 2);
          const my = e.clientY - (r.top + r.height / 2);
          a.style.transform =
            "translate(" + (mx * 0.25).toFixed(1) + "px," + (my * 0.32).toFixed(1) + "px)";
        };
        const ml = () => {
          a.style.transform = "translate(0,0)";
        };
        a.addEventListener("pointermove", mm);
        a.addEventListener("pointerleave", ml);
        ptrCleanups.push(() => {
          a.removeEventListener("pointermove", mm);
          a.removeEventListener("pointerleave", ml);
        });
      });
    }

    // ── cleanup ───────────────────────────────────────────────────────────────
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll, true);
      if (tt) clearTimeout(tt);
      if (introT) clearTimeout(introT);
      stopStepType();
      stopAuto();
      tabs.forEach((t, i) => t.removeEventListener("click", tabClicks[i]));
      if (howSec) {
        howSec.removeEventListener("mouseenter", onEnter);
        howSec.removeEventListener("mouseleave", onLeave);
      }
      if (howIO) howIO.disconnect();
      ptrCleanups.forEach((fn) => {
        try {
          fn();
        } catch {
          /* noop */
        }
      });
    };
    // Re-run when the points toggle changes (it gates the points opacity in
    // update()); scrollLength/showGrain only affect markup, handled in JSX.
  }, [rootRef, showPoints]);
}
