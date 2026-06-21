"use client";

import { useEffect, useRef } from "react";

/**
 * GPFree — scroll-driven cinematic hero + how-it-works + footer.
 *
 * Faithful React port of the design handoff (design_handoff_gpfree_hero).
 * The whole hero is "one sticky stage + N absolutely-stacked layers whose
 * opacity/transform are functions of a single scroll-progress value p∈[0,1]".
 * The original in-house runtime is ignored; the progress→style mapping is
 * reproduced with a rAF-throttled scroll listener (capture phase) plus an
 * IntersectionObserver for the how-it-works stepper.
 */

const FB = "var(--font-bodoni), Georgia, serif";
const FM = "var(--font-jetbrains), ui-monospace, monospace";

const FRAMES = [
  "/assets/seq-01.webp",
  "/assets/seq-03.webp",
  "/assets/seq-05.webp",
  "/assets/seq-07.webp",
  "/assets/seq-09.webp",
  "/assets/seq-11.webp",
  "/assets/seq-12.webp",
  "/assets/seq-13.webp",
];

// [top%, left%, fontSize, blur, glowAlpha, durationS, delayS]
const POINTS: [string, string, number, number, number, number, number][] = [
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

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const CSS = `
@keyframes gpxHint { 0%,100% { transform: translateY(0); opacity: 0.55; } 50% { transform: translateY(7px); opacity: 1; } }
@keyframes gpxCaret { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
@keyframes gpxIntro { from { transform: scale(1.16); } to { transform: scale(1); } }
@keyframes gpxCurtain { from { opacity: 1; } to { opacity: 0; } }
@keyframes gpxRise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes gpxGlint { 0% { transform: translateX(-160%) rotate(8deg); } 100% { transform: translateX(220%) rotate(8deg); } }
@keyframes gpxFloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
@keyframes gpxPts { 0% { transform: translateY(14px); opacity: 0; } 25% { opacity: 0.9; } 70% { opacity: 0.7; } 100% { transform: translateY(-22px); opacity: 0; } }

.gpx-cta-ivory:hover { background:#C8A35E !important; }
.gpx-cta-ink:hover { background:#A87C2E !important; }
.gpx-cta-gilt:hover { background:#DCC089 !important; }
.gpx-ghost:hover { background:rgba(242,234,221,0.12) !important; }

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

export default function GPFreeHero() {
  const rootRef = useRef<HTMLDivElement>(null);

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
      let t = clamp01((p - a0) / span);
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
        f.style.transform =
          "scale(" + (1.05 - Math.max(-1, Math.min(1, loc)) * 0.022) + ")";
      }

      // text beats anchored to progress
      const W = 0.13;
      for (let i = 0; i < beats.length; i++) {
        const d = Math.abs(p - beatCenters[i]);
        const o = smooth(1 - d / W);
        const b = beats[i];
        b.style.opacity = String(o);
        b.style.pointerEvents = o > 0.55 ? "auto" : "none";
        const on = o > 0.5 && !(intro && i === 0);
        const ls = beatLines[i];
        for (let j = 0; j < ls.length; j++) {
          ls[j].style.opacity = on ? "1" : "0";
          ls[j].style.transform = on ? "translateY(0)" : "translateY(26px)";
        }
      }

      if (barEl) barEl.style.transform = "scaleX(" + p + ")";
      if (hintEl) hintEl.style.opacity = String(Math.max(0, 1 - p * 6));
      if (ptsEl) ptsEl.style.opacity = String(smooth(1 - Math.abs(p - 0.33) / 0.2));
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
      const out = wrap.firstChild as HTMLElement;
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
      const out = wrap.firstChild as HTMLElement;
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
        t.style.background = on ? "rgba(255,255,255,0.05)" : "transparent";
        t.style.borderLeftColor = on ? "#C8A35E" : "transparent";
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
    };
  }, []);

  const beatHeadStyle: React.CSSProperties = {
    margin: 0,
    fontFamily: FB,
    fontWeight: 500,
    fontSize: "clamp(48px,6.2vw,104px)",
    lineHeight: 1.0,
    letterSpacing: 0,
    color: "#F2EADD",
    textShadow: "0 1px 2px rgba(12,10,7,0.4), 0 6px 44px rgba(12,10,7,0.5)",
  };
  const lineTr: React.CSSProperties = {
    transition:
      "opacity 0.8s ease, transform 0.8s cubic-bezier(0.2,0.8,0.2,1)",
  };
  const kicker: React.CSSProperties = {
    fontFamily: FM,
    fontSize: 12,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color: "#C8A35E",
    textShadow: "0 1px 12px rgba(12,10,7,0.8)",
  };

  return (
    <div
      id="gpx-hero"
      ref={rootRef}
      style={{ background: "#0C0A07", color: "#F2EADD", fontFamily: FM }}
    >
      <style>{CSS}</style>

      <div data-track style={{ position: "relative", height: "760vh" }}>
        <div
          data-stage
          style={{
            position: "sticky",
            top: 0,
            height: "100vh",
            overflow: "hidden",
            background: "#0C0A07",
          }}
        >
          {/* ════ SOFT FRAME DISSOLVE + cinematic push-in ════ */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              animation: "gpxIntro 2.4s cubic-bezier(0.16,1,0.3,1) both",
            }}
          >
            {FRAMES.map((src, i) => (
              <img
                key={src}
                data-frame={i}
                src={src}
                alt=""
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  opacity: i === 0 ? 1 : 0,
                  transform: "scale(1.05)",
                  transformOrigin: "center",
                  willChange: "opacity,transform",
                }}
              />
            ))}
          </div>

          {/* ════ FOIL GLINT SWEEP ════ */}
          <div
            style={{
              position: "absolute",
              top: "-25%",
              left: 0,
              width: "32%",
              height: "150%",
              pointerEvents: "none",
              mixBlendMode: "screen",
              opacity: 0.55,
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255,248,235,0.08) 42%, rgba(255,255,255,0.18) 50%, rgba(200,163,94,0.10) 58%, transparent 100%)",
              filter: "blur(7px)",
              animation: "gpxGlint 8s ease-in-out 2.6s infinite",
            }}
          />

          {/* ════ CINEMATIC SCRIM + VIGNETTE ════ */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background:
                "linear-gradient(180deg, rgba(12,10,7,0.62) 0%, rgba(12,10,7,0.08) 24%, rgba(12,10,7,0.08) 46%, rgba(12,10,7,0.84) 100%), linear-gradient(100deg, rgba(12,10,7,0.8) 0%, rgba(12,10,7,0.34) 38%, rgba(12,10,7,0) 62%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              boxShadow: "inset 0 0 320px rgba(12,10,7,0.82)",
            }}
          />

          {/* ════ FILM GRAIN ════ */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              opacity: 0.07,
              mixBlendMode: "overlay",
              backgroundImage: GRAIN,
              backgroundSize: "200px 200px",
            }}
          />

          {/* ════ FLOATING +100,000 ════ */}
          <div
            data-points
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 18,
              pointerEvents: "none",
              opacity: 0,
            }}
          >
            {POINTS.map(([top, left, size, blur, alpha, dur, delay], i) => (
              <span
                key={i}
                style={{
                  position: "absolute",
                  top,
                  left,
                  fontFamily: FM,
                  fontWeight: 600,
                  fontSize: size,
                  color: "#C8A35E",
                  textShadow: `0 0 ${blur}px rgba(200,163,94,${alpha})`,
                  animation: `gpxPts ${dur}s ease-in-out ${delay}s infinite`,
                }}
              >
                +100,000
              </span>
            ))}
          </div>

          {/* ════ WORDMARK ════ */}
          <div
            style={{
              position: "absolute",
              top: 34,
              left: "7vw",
              zIndex: 40,
              display: "flex",
              alignItems: "center",
              gap: 9,
              animation: "gpxRise 0.9s ease 1s both",
            }}
          >
            <span
              style={{
                fontFamily: FB,
                fontWeight: 500,
                fontSize: 16,
                letterSpacing: "0.34em",
                textTransform: "uppercase",
                color: "#F2EADD",
                paddingLeft: "0.34em",
              }}
            >
              gpfree
            </span>
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "#C8A35E",
                boxShadow: "0 0 10px rgba(200,163,94,0.85)",
              }}
            />
          </div>

          {/* ════ BEAT: opener ════ */}
          <div
            data-beat
            data-center="0.05"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 20,
              display: "flex",
              alignItems: "center",
              opacity: 1,
            }}
          >
            <div style={{ padding: "0 7vw", maxWidth: 760 }}>
              <h2 style={beatHeadStyle}>
                <span data-line style={{ display: "block", ...lineTr, transitionDelay: "0s" }}>
                  Your points are worth
                </span>
                <span data-line style={{ display: "block", ...lineTr, transitionDelay: "0.1s" }}>
                  <em style={{ fontStyle: "italic", color: "#C8A35E" }}>more</em> than you think
                </span>
              </h2>
              <div data-line style={{ marginTop: 26, height: 18, ...lineTr, transitionDelay: "0.2s" }}>
                <span
                  data-typer
                  style={{ fontFamily: FM, fontSize: 13, letterSpacing: "0.02em", color: "rgba(242,234,221,0.66)" }}
                >
                  <span />
                  <span style={{ color: "#C8A35E", animation: "gpxCaret 1s step-end infinite" }}>▍</span>
                </span>
              </div>
              <div data-line style={{ marginTop: 34, ...lineTr, transitionDelay: "0.3s" }}>
                <a
                  href="#gpx-how"
                  className="gpx-cta-ivory"
                  style={{
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "#0C0A07",
                    background: "#F2EADD",
                    padding: "16px 32px",
                    borderRadius: 999,
                    transition: "background 0.3s ease",
                  }}
                >
                  see how it works <span style={{ fontSize: 14 }}>→</span>
                </a>
              </div>
            </div>
          </div>

          {/* ════ BEAT: balance ════ */}
          <div
            data-beat
            data-center="0.40"
            style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "center", opacity: 0 }}
          >
            <div style={{ padding: "0 7vw", maxWidth: 760 }}>
              <div
                data-line
                style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, ...lineTr, transitionDelay: "0s" }}
              >
                <span style={{ width: 24, height: 1, background: "#C8A35E" }} />
                <span style={kicker}>every program · checked in real time</span>
              </div>
              <h2 style={beatHeadStyle}>
                <span data-line style={{ display: "block", ...lineTr, transitionDelay: "0.08s" }}>
                  Watch your balance
                </span>
                <span data-line style={{ display: "block", ...lineTr, transitionDelay: "0.1s" }}>
                  <em style={{ fontStyle: "italic", color: "#C8A35E" }}>take off</em>
                </span>
              </h2>
            </div>
          </div>

          {/* ════ BEAT: destinations ════ */}
          <div
            data-beat
            data-center="0.70"
            style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "center", opacity: 0 }}
          >
            <div style={{ padding: "0 7vw", maxWidth: 760 }}>
              <div
                data-line
                style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, ...lineTr, transitionDelay: "0s" }}
              >
                <span style={{ width: 24, height: 1, background: "#C8A35E" }} />
                <span style={kicker}>saver seats · the moment they open</span>
              </div>
              <h2 style={beatHeadStyle}>
                <span data-line style={{ display: "block", ...lineTr, transitionDelay: "0.08s" }}>
                  Every trip,
                </span>
                <span data-line style={{ display: "block", ...lineTr, transitionDelay: "0.1s" }}>
                  <em style={{ fontStyle: "italic", color: "#C8A35E" }}>already paid for</em>
                </span>
              </h2>
            </div>
          </div>

          {/* ════ BEAT: closing (metal credit card) ════ */}
          <div
            data-beat
            data-center="1.0"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 20,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              opacity: 0,
            }}
          >
            <div
              style={{
                position: "relative",
                width: "min(90vw,560px)",
                padding: "32px 40px 30px",
                textAlign: "left",
                background: "linear-gradient(145deg,#FCFAF4 0%,#ECE6D9 52%,#F4EFE3 100%)",
                border: "1px solid rgba(255,255,255,0.55)",
                borderRadius: 22,
                boxShadow: "0 44px 110px rgba(0,0,0,0.52), inset 0 1px 0 rgba(255,255,255,0.85)",
                overflow: "hidden",
                animation: "gpxFloat 6s ease-in-out infinite",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  background:
                    "linear-gradient(118deg, transparent 32%, rgba(255,255,255,0.55) 49%, transparent 60%)",
                  opacity: 0.45,
                }}
              />
              <div
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 30,
                }}
              >
                {/* EMV chip */}
                <div
                  style={{
                    width: 48,
                    height: 36,
                    borderRadius: 7,
                    background: "linear-gradient(135deg,#ead69e,#b8923f)",
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
                    position: "relative",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: 5,
                      bottom: 5,
                      width: 1,
                      background: "rgba(0,0,0,0.2)",
                      transform: "translateX(-50%)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: 5,
                      right: 5,
                      height: 1,
                      background: "rgba(0,0,0,0.2)",
                      transform: "translateY(-50%)",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: FB,
                    fontWeight: 500,
                    fontSize: 13,
                    letterSpacing: "0.32em",
                    textTransform: "uppercase",
                    color: "#14110B",
                    paddingLeft: "0.32em",
                  }}
                >
                  gpfree
                </span>
              </div>
              <h2
                style={{
                  position: "relative",
                  margin: 0,
                  fontFamily: FB,
                  fontWeight: 500,
                  fontSize: "clamp(40px,4.4vw,66px)",
                  lineHeight: 0.98,
                  letterSpacing: 0,
                  color: "#14110B",
                }}
              >
                <span data-line style={{ display: "block", ...lineTr, transitionDelay: "0s" }}>
                  Go <em style={{ fontStyle: "italic", color: "#A87C2E" }}>anywhere</em>
                </span>
              </h2>
              <div data-line style={{ position: "relative", marginTop: 26, ...lineTr, transitionDelay: "0.16s" }}>
                <a
                  href="#"
                  className="gpx-cta-ink"
                  style={{
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "#F7F2E9",
                    background: "#14110B",
                    padding: "15px 30px",
                    borderRadius: 999,
                    boxShadow: "0 12px 34px rgba(0,0,0,0.28)",
                    transition: "background 0.3s ease",
                  }}
                >
                  start optimizing — free <span style={{ fontSize: 15 }}>→</span>
                </a>
              </div>
              <div data-line style={{ position: "relative", marginTop: 20, ...lineTr, transitionDelay: "0.26s" }}>
                <span
                  style={{
                    fontFamily: FM,
                    fontSize: 10,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "rgba(20,17,11,0.48)",
                  }}
                >
                  no card numbers stored&nbsp;&nbsp;·&nbsp;&nbsp;free to start&nbsp;&nbsp;·&nbsp;&nbsp;2-min setup
                </span>
              </div>
            </div>
          </div>

          {/* ════ SLIM PROGRESS BAR ════ */}
          <div
            style={{
              position: "absolute",
              bottom: 34,
              left: "7vw",
              zIndex: 30,
              width: 150,
              height: 2,
              background: "rgba(242,234,221,0.16)",
              borderRadius: 2,
              overflow: "hidden",
              animation: "gpxRise 0.9s ease 1.15s both",
            }}
          >
            <div
              data-bar
              style={{
                width: "100%",
                height: "100%",
                background: "#C8A35E",
                transform: "scaleX(0)",
                transformOrigin: "left center",
                transition: "transform 0.1s linear",
              }}
            />
          </div>

          {/* ════ PERSISTENT GHOST CTA ════ */}
          <a
            href="#"
            className="gpx-ghost"
            style={{
              position: "absolute",
              bottom: 28,
              right: "5vw",
              zIndex: 30,
              animation: "gpxRise 0.9s ease 1.15s both",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 9,
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: "#F2EADD",
              border: "1px solid rgba(242,234,221,0.32)",
              padding: "12px 22px",
              borderRadius: 999,
              backdropFilter: "blur(8px)",
              transition: "background 0.3s ease",
            }}
          >
            start optimizing <span style={{ fontSize: 13 }}>→</span>
          </a>

          {/* ════ SCROLL HINT ════ */}
          <div
            data-hint
            style={{
              position: "absolute",
              bottom: 30,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 30,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 7,
              pointerEvents: "none",
            }}
          >
            <span
              style={{
                fontFamily: FM,
                fontSize: 10,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: "rgba(242,234,221,0.55)",
              }}
            >
              scroll
            </span>
            <div
              style={{
                width: 1,
                height: 26,
                background: "linear-gradient(180deg, rgba(242,234,221,0.7), transparent)",
                animation: "gpxHint 1.8s ease-in-out infinite",
              }}
            />
          </div>

          {/* ════ CINEMATIC ENTRANCE CURTAIN ════ */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 60,
              background: "#0C0A07",
              pointerEvents: "none",
              animation: "gpxCurtain 1.5s ease 0.15s both",
            }}
          />
        </div>
      </div>

      {/* ══════════════ HOW IT WORKS ══════════════ */}
      <section
        id="gpx-how"
        style={{
          position: "relative",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          padding: "120px 7vw",
          overflow: "hidden",
          background: "#0C0A07",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "50%",
            transform: "translateX(-50%)",
            width: 1,
            height: 70,
            background: "linear-gradient(180deg, transparent, rgba(200,163,94,0.65))",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "-10%",
            left: "50%",
            width: 900,
            height: 520,
            transform: "translateX(-50%)",
            background: "radial-gradient(ellipse at center, rgba(200,163,94,0.07), transparent 68%)",
            pointerEvents: "none",
          }}
        />

        <div
          data-howgrid
          style={{
            position: "relative",
            width: "100%",
            maxWidth: 1320,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "0.92fr 1.08fr",
            gap: 80,
            alignItems: "center",
          }}
        >
          {/* LEFT: steps */}
          <div
            data-reveal
            style={{
              opacity: 0,
              transform: "translateY(24px)",
              transition: "opacity 0.8s ease, transform 0.8s cubic-bezier(0.2,0.8,0.2,1)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 22 }}>
              <div style={{ width: 30, height: 1, background: "#C8A35E" }} />
              <span
                style={{
                  fontFamily: FM,
                  fontSize: 11,
                  letterSpacing: "0.24em",
                  textTransform: "uppercase",
                  color: "#C8A35E",
                }}
              >
                how it works
              </span>
            </div>
            <h2
              style={{
                margin: "0 0 42px",
                fontFamily: FB,
                fontWeight: 500,
                fontSize: "clamp(38px,3.8vw,60px)",
                lineHeight: 1.02,
                letterSpacing: 0,
                color: "#F2EADD",
              }}
            >
              Three steps to
              <br />
              your next trip
            </h2>

            <div data-steps style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                {
                  n: "01",
                  title: "Build your wallet",
                  desc: "Add the cards you already carry. We never store the numbers.",
                  active: true,
                },
                {
                  n: "02",
                  title: "Name the trip",
                  desc: "Tell us where you want to go, in plain words.",
                  active: false,
                },
                {
                  n: "03",
                  title: "Let the agents plan",
                  desc: "They search every program and book the sweet spot.",
                  active: false,
                },
              ].map((s, i) => (
                <div
                  key={s.n}
                  data-step={i}
                  style={{
                    cursor: "pointer",
                    padding: "18px 22px",
                    borderRadius: 5,
                    borderLeft: `2px solid ${s.active ? "#C8A35E" : "transparent"}`,
                    background: s.active ? "rgba(255,255,255,0.05)" : "transparent",
                    transition: "background 0.4s ease, border-color 0.4s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
                    <span style={{ fontFamily: FM, fontSize: 12, color: "#C8A35E", flex: "none" }}>
                      {s.n}
                    </span>
                    <div>
                      <div style={{ fontFamily: FB, fontSize: 23, color: "#F2EADD" }}>{s.title}</div>
                      <div
                        style={{
                          fontSize: 13,
                          color: "rgba(242,234,221,0.6)",
                          marginTop: 5,
                          lineHeight: 1.5,
                        }}
                      >
                        {s.desc}
                      </div>
                    </div>
                  </div>
                  <div
                    data-stepbar
                    style={{
                      height: 2,
                      background: "rgba(242,234,221,0.12)",
                      marginTop: 15,
                      borderRadius: 2,
                      overflow: "hidden",
                      opacity: s.active ? 1 : 0,
                      transition: "opacity 0.3s ease",
                    }}
                  >
                    <div data-stepfill style={{ height: "100%", width: "0%", background: "#C8A35E" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT: animated stage */}
          <div
            data-reveal
            data-howstage
            style={{
              position: "relative",
              aspectRatio: "4/3",
              border: "1px solid rgba(242,234,221,0.1)",
              borderRadius: 8,
              background: "linear-gradient(160deg, rgba(255,255,255,0.045), rgba(255,255,255,0.012))",
              overflow: "hidden",
              boxShadow: "0 50px 130px rgba(0,0,0,0.5)",
              opacity: 0,
              transform: "translateY(24px)",
              transition:
                "opacity 0.8s ease 0.12s, transform 0.8s cubic-bezier(0.2,0.8,0.2,1) 0.12s",
            }}
          >
            {/* panel 0: wallet */}
            <div
              data-steppanel="0"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 1,
                transition: "opacity 0.6s ease",
              }}
            >
              <div style={{ position: "relative", width: 300, height: 210 }}>
                <div
                  data-anim
                  data-final="translate(-96px,8px) rotate(-10deg)"
                  data-hidden="translate(-96px,52px) rotate(-10deg)"
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: 190,
                    height: 120,
                    margin: "-60px 0 0 -95px",
                    borderRadius: 13,
                    background: "linear-gradient(150deg,#2a2c34,#15171e)",
                    boxShadow: "0 18px 44px rgba(0,0,0,0.55)",
                    padding: 16,
                    opacity: 0,
                    transform: "translate(-96px,52px) rotate(-10deg)",
                    transition:
                      "opacity 0.6s ease 0.05s, transform 0.7s cubic-bezier(0.2,0.8,0.2,1) 0.05s",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ position: "absolute", top: 0, left: 0, width: 4, height: "100%", background: "#7d97ff" }} />
                  <div style={{ width: 30, height: 22, borderRadius: 5, background: "linear-gradient(135deg,#d8c08a,#b08d3f)" }} />
                  <div style={{ position: "absolute", bottom: 15, left: 16, fontFamily: FM, fontSize: 10, color: "rgba(242,234,221,0.55)" }}>
                    •••• 4821
                  </div>
                </div>
                <div
                  data-anim
                  data-final="translate(96px,10px) rotate(10deg)"
                  data-hidden="translate(96px,52px) rotate(10deg)"
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: 190,
                    height: 120,
                    margin: "-60px 0 0 -95px",
                    borderRadius: 13,
                    background: "linear-gradient(150deg,#2c2a20,#17150d)",
                    boxShadow: "0 18px 44px rgba(0,0,0,0.55)",
                    padding: 16,
                    opacity: 0,
                    transform: "translate(96px,52px) rotate(10deg)",
                    transition:
                      "opacity 0.6s ease 0.18s, transform 0.7s cubic-bezier(0.2,0.8,0.2,1) 0.18s",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ position: "absolute", top: 0, left: 0, width: 4, height: "100%", background: "#d2ad5e" }} />
                  <div style={{ width: 30, height: 22, borderRadius: 5, background: "linear-gradient(135deg,#d8c08a,#b08d3f)" }} />
                  <div style={{ position: "absolute", bottom: 15, left: 16, fontFamily: FM, fontSize: 10, color: "rgba(242,234,221,0.55)" }}>
                    •••• 7390
                  </div>
                </div>
                <div
                  data-anim
                  data-final="translate(0,-6px) rotate(-1deg)"
                  data-hidden="translate(0,44px) rotate(-1deg)"
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: 198,
                    height: 124,
                    margin: "-62px 0 0 -99px",
                    borderRadius: 13,
                    background: "linear-gradient(150deg,#3a3d47,#1f222b)",
                    boxShadow: "0 26px 56px rgba(0,0,0,0.6)",
                    padding: 17,
                    opacity: 0,
                    transform: "translate(0,44px) rotate(-1deg)",
                    transition:
                      "opacity 0.6s ease 0.3s, transform 0.7s cubic-bezier(0.2,0.8,0.2,1) 0.3s",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ position: "absolute", top: 0, left: 0, width: 4, height: "100%", background: "#C8A35E" }} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ width: 32, height: 23, borderRadius: 5, background: "linear-gradient(135deg,#e2cf9a,#bd9a4a)" }} />
                    <span style={{ fontFamily: FM, fontSize: 9, letterSpacing: "0.1em", color: "rgba(242,234,221,0.5)" }}>
                      PRIMARY
                    </span>
                  </div>
                  <div style={{ position: "absolute", bottom: 15, left: 17, fontFamily: FM, fontSize: 10, color: "rgba(242,234,221,0.7)" }}>
                    •••• 1205
                  </div>
                </div>
              </div>
            </div>

            {/* panel 1: ask */}
            <div
              data-steppanel="1"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0,
                pointerEvents: "none",
                transition: "opacity 0.6s ease",
              }}
            >
              <div style={{ width: "80%", maxWidth: 440 }}>
                <div
                  data-anim
                  data-final="translateY(0)"
                  data-hidden="translateY(24px)"
                  style={{
                    opacity: 0,
                    transform: "translateY(24px)",
                    transition:
                      "opacity 0.6s ease 0.05s, transform 0.7s cubic-bezier(0.2,0.8,0.2,1) 0.05s",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(242,234,221,0.14)",
                    borderRadius: 14,
                    padding: "20px 22px 18px",
                  }}
                >
                  <div
                    style={{
                      fontFamily: FM,
                      fontSize: 10,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      color: "rgba(242,234,221,0.45)",
                      marginBottom: 13,
                    }}
                  >
                    your goal
                  </div>
                  <div
                    style={{
                      fontFamily: FB,
                      fontStyle: "italic",
                      fontSize: 25,
                      lineHeight: 1.3,
                      color: "#F2EADD",
                      minHeight: 66,
                    }}
                  >
                    <span data-howtyper>
                      <span />
                      <span style={{ color: "#C8A35E", animation: "gpxCaret 1s step-end infinite" }}>▍</span>
                    </span>
                  </div>
                </div>
                <div
                  data-anim
                  data-final="translateY(0)"
                  data-hidden="translateY(24px)"
                  style={{
                    opacity: 0,
                    transform: "translateY(24px)",
                    transition:
                      "opacity 0.6s ease 0.22s, transform 0.7s cubic-bezier(0.2,0.8,0.2,1) 0.22s",
                    marginTop: 16,
                    display: "flex",
                    justifyContent: "flex-end",
                  }}
                >
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 9,
                      fontFamily: FM,
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      color: "#0C0A07",
                      background: "#C8A35E",
                      padding: "13px 24px",
                      borderRadius: 999,
                    }}
                  >
                    plan it →
                  </span>
                </div>
              </div>
            </div>

            {/* panel 2: plan */}
            <div
              data-steppanel="2"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: 0,
                pointerEvents: "none",
                transition: "opacity 0.6s ease",
              }}
            >
              <div style={{ width: "82%", maxWidth: 460 }}>
                {[
                  { dot: "#1f9d8f", label: "WALLET", text: "read balances · 180,000 pts", delay: "0.05s", t: "0.55s" },
                  { dot: "#bd8a2e", label: "EARNING", text: "route spend · 3× travel", delay: "0.16s", t: "0.55s" },
                  { dot: "#4f7cf0", label: "REDEEM", text: "transfer → ANA · 1:1", delay: "0.27s", t: "0.55s" },
                ].map((r) => (
                  <div
                    key={r.label}
                    data-anim
                    data-final="translateY(0)"
                    data-hidden="translateY(22px)"
                    style={{
                      opacity: 0,
                      transform: "translateY(22px)",
                      transition: `opacity ${r.t} ease ${r.delay}, transform 0.6s cubic-bezier(0.2,0.8,0.2,1) ${r.delay}`,
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 15px",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(242,234,221,0.08)",
                      borderRadius: 10,
                      marginBottom: 9,
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: 2, background: r.dot, flex: "none" }} />
                    <span style={{ fontFamily: FM, fontSize: 10, fontWeight: 600, color: r.dot, width: 62, flex: "none" }}>
                      {r.label}
                    </span>
                    <span style={{ fontFamily: FM, fontSize: 11, color: "rgba(242,234,221,0.78)", flex: 1 }}>
                      {r.text}
                    </span>
                    <span style={{ color: "#1f9d8f", fontSize: 12 }}>✓</span>
                  </div>
                ))}
                <div
                  data-anim
                  data-final="translateY(0)"
                  data-hidden="translateY(22px)"
                  style={{
                    opacity: 0,
                    transform: "translateY(22px)",
                    transition:
                      "opacity 0.55s ease 0.4s, transform 0.6s cubic-bezier(0.2,0.8,0.2,1) 0.4s",
                    marginTop: 15,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "16px 18px",
                    background: "rgba(200,163,94,0.1)",
                    border: "1px solid rgba(200,163,94,0.4)",
                    borderRadius: 12,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: FM,
                        fontSize: 9,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                        color: "rgba(200,163,94,0.85)",
                      }}
                    >
                      your plan
                    </div>
                    <div style={{ fontFamily: FB, fontSize: 19, color: "#F2EADD", marginTop: 3 }}>
                      Business saver · LAX → TYO
                    </div>
                  </div>
                  <div style={{ fontFamily: FB, fontSize: 22, color: "#C8A35E" }}>120k</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════ FOOTER ══════════════ */}
      <footer
        style={{
          position: "relative",
          background: "#0C0A07",
          borderTop: "1px solid rgba(242,234,221,0.08)",
          padding: "84px 7vw 46px",
          color: "#F2EADD",
        }}
      >
        <div style={{ maxWidth: 1320, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "48px 64px",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}
          >
            <div style={{ maxWidth: 440 }}>
              <h3
                style={{
                  margin: "0 0 26px",
                  fontFamily: FB,
                  fontWeight: 500,
                  fontSize: "clamp(28px,2.8vw,44px)",
                  lineHeight: 1.06,
                  color: "#F2EADD",
                }}
              >
                Your next trip is
                <br />
                one scroll away.
              </h3>
              <a
                href="#"
                className="gpx-cta-gilt"
                style={{
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "#0C0A07",
                  background: "#C8A35E",
                  padding: "15px 30px",
                  borderRadius: 999,
                  transition: "background 0.3s ease",
                }}
              >
                start optimizing — free <span style={{ fontSize: 15 }}>→</span>
              </a>
            </div>
          </div>
          <div style={{ height: 1, background: "rgba(242,234,221,0.08)", margin: "48px 0 22px" }} />
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span
                style={{
                  fontFamily: FB,
                  fontWeight: 500,
                  fontSize: 14,
                  letterSpacing: "0.32em",
                  textTransform: "uppercase",
                  color: "#F2EADD",
                  paddingLeft: "0.32em",
                }}
              >
                gpfree
              </span>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#C8A35E" }} />
            </div>
            <span style={{ fontFamily: FM, fontSize: 11, color: "rgba(242,234,221,0.4)", letterSpacing: "0.04em" }}>
              coordination is state, not messages
            </span>
            <span style={{ fontFamily: FM, fontSize: 11, color: "rgba(242,234,221,0.4)" }}>© 2026 GPFree</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
