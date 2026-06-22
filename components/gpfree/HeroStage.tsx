import {
  beatHeadStyle,
  CTA_PILL,
  FB,
  FM,
  FRAMES,
  FS,
  GRAIN,
  initiallyHidden,
  kicker,
  LEN_MAP,
  lineTr,
  POINTS,
  type GPFreeHeroProps,
} from "./cinema";

type Props = Required<GPFreeHeroProps>;

/** Sticky cinematic hero: scroll-driven frame dissolve + text beats + overlays. */
export default function HeroStage({ scrollLength, showPoints, showGrain }: Props) {
  return (
    <div data-track style={{ position: "relative", height: LEN_MAP[scrollLength] }}>
      <div
        data-stage
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          overflow: "hidden",
          background: "var(--color-bg)",
        }}
      >
        {/* ════ SOFT FRAME DISSOLVE (opacity crossfade only — no zoom) ════ */}
        <div data-parallax style={{ position: "absolute", inset: 0, willChange: "transform" }}>
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
                willChange: "opacity",
              }}
            />
          ))}
        </div>

        {/* ════ POINTER-REACTIVE LIGHT (iris tint) ════ */}
        <div
          data-glow
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            pointerEvents: "none",
            mixBlendMode: "multiply",
            opacity: 0,
            transition: "var(--transition-opacity)",
            background:
              "radial-gradient(360px circle at var(--gx,50%) var(--gy,42%), color-mix(in srgb, var(--color-accent) 22%, transparent), color-mix(in srgb, var(--color-accent-subtle) 10%, transparent) 42%, transparent 72%)",
          }}
        />

        {/* ════ FOIL GLINT SWEEP ════ */}
        <div
          style={{
            position: "absolute",
            top: "-25%",
            left: 0,
            width: "32%",
            height: "150%",
            pointerEvents: "none",
            mixBlendMode: "overlay",
            opacity: 0.5,
            background:
              "linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--color-neutral-0) 40%, transparent) 50%, transparent 100%)",
            filter: "var(--blur-sm)",
            animation: "gpxGlint 8s ease-in-out 2.6s infinite",
          }}
        />

        {/* ════ LEGIBILITY SCRIM + VIGNETTE (light) ════ */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--color-bg) 70%, transparent) 0%, color-mix(in srgb, var(--color-bg) 10%, transparent) 26%, color-mix(in srgb, var(--color-bg) 12%, transparent) 50%, color-mix(in srgb, var(--color-bg) 86%, transparent) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            boxShadow: "inset 0 0 320px color-mix(in srgb, var(--color-neutral-900) 10%, transparent)",
          }}
        />

        {/* ════ COPY SCRIM (left column legibility) ════ */}
        {/* Sits below the beats (z 20) but above the imagery so the dark
            headline/CTA stay readable over any frame, without washing out the
            card on the right. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 15,
            pointerEvents: "none",
            background:
              "linear-gradient(90deg, color-mix(in srgb, var(--color-bg) 86%, transparent) 0%, color-mix(in srgb, var(--color-bg) 55%, transparent) 26%, transparent 56%)",
          }}
        />

        {/* ════ FILM GRAIN ════ */}
        {showGrain && (
          <div
            data-grain
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              opacity: 0.05,
              mixBlendMode: "multiply",
              backgroundImage: GRAIN,
              backgroundSize: "200px 200px",
            }}
          />
        )}

        {/* ════ FLOATING +100,000 ════ */}
        <div
          data-points
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 18,
            pointerEvents: "none",
            opacity: 0,
            display: showPoints ? undefined : "none",
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
                fontWeight: "var(--weight-semibold)" as unknown as number,
                fontSize: size,
                color: "var(--color-accent-text)",
                textShadow: `0 0 ${blur}px color-mix(in srgb, var(--color-accent) ${Math.round(
                  alpha * 100,
                )}%, transparent)`,
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
            top: "var(--space-8)",
            left: "7vw",
            zIndex: 40,
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            animation: "gpxRise 0.9s ease 1s both",
          }}
        >
          <span
            style={{
              fontFamily: FB,
              fontWeight: "var(--weight-semibold)" as unknown as number,
              fontSize: "var(--text-md)",
              letterSpacing: "var(--tracking-widest)",
              textTransform: "uppercase",
              color: "var(--color-text-primary)",
              paddingLeft: "var(--tracking-widest)",
            }}
          >
            gpfree
          </span>
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "var(--radius-full)",
              background: "var(--color-accent)",
              boxShadow: "0 0 10px color-mix(in srgb, var(--color-accent) 60%, transparent)",
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
          <div style={{ padding: "0 7vw", maxWidth: 920 }}>
            <h1 style={beatHeadStyle}>
              <span data-line style={{ display: "block", ...lineTr, transitionDelay: "0s" }}>
                Your points are worth
              </span>
              <span data-line style={{ display: "block", ...lineTr, transitionDelay: "0.1s" }}>
                <em style={{ fontStyle: "italic", color: "var(--color-accent-text)" }}>more</em> than you think
              </span>
            </h1>
            <div data-line style={{ marginTop: "var(--space-6)", height: 18, ...lineTr, transitionDelay: "0.2s" }}>
              <span
                data-typer
                style={{
                  fontFamily: FM,
                  fontSize: "var(--text-sm)",
                  letterSpacing: "var(--tracking-normal)",
                  color: "var(--color-text-secondary)",
                }}
              >
                <span />
                <span style={{ color: "var(--color-accent)", animation: "gpxCaret 1s step-end infinite" }}>▍</span>
              </span>
            </div>
            <div data-line style={{ marginTop: "var(--space-8)", ...lineTr, transitionDelay: "0.3s" }}>
              <a
                href="#gpx-how"
                className="gpx-cta-ivory"
                data-mag
                style={{
                  ...CTA_PILL,
                  color: "var(--color-neutral-0)",
                  background: "var(--color-accent)",
                  padding: "var(--space-4) var(--space-8)",
                }}
              >
                see how it works <span style={{ fontSize: "var(--text-sm)" }}>→</span>
              </a>
            </div>
          </div>
        </div>

        {/* ════ BEAT: balance ════ */}
        <div
          data-beat
          data-center="0.40"
          {...initiallyHidden}
          style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "center", opacity: 0 }}
        >
          <div style={{ padding: "0 7vw", maxWidth: 920 }}>
            <div
              data-line
              style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-5)", ...lineTr, transitionDelay: "0s" }}
            >
              <span style={{ width: 24, height: 1, background: "var(--color-accent)" }} />
              <span style={kicker}>every program · checked in real time</span>
            </div>
            <h2 style={beatHeadStyle}>
              <span data-line style={{ display: "block", ...lineTr, transitionDelay: "0.08s" }}>
                Watch your balance
              </span>
              <span data-line style={{ display: "block", ...lineTr, transitionDelay: "0.1s" }}>
                <em style={{ fontStyle: "italic", color: "var(--color-accent-text)" }}>take off</em>
              </span>
            </h2>
          </div>
        </div>

        {/* ════ BEAT: destinations ════ */}
        <div
          data-beat
          data-center="0.70"
          {...initiallyHidden}
          style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "center", opacity: 0 }}
        >
          <div style={{ padding: "0 7vw", maxWidth: 920 }}>
            <div
              data-line
              style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-5)", ...lineTr, transitionDelay: "0s" }}
            >
              <span style={{ width: 24, height: 1, background: "var(--color-accent)" }} />
              <span style={kicker}>saver seats · the moment they open</span>
            </div>
            <h2 style={beatHeadStyle}>
              <span data-line style={{ display: "block", ...lineTr, transitionDelay: "0.08s" }}>
                Every trip,
              </span>
              <span data-line style={{ display: "block", ...lineTr, transitionDelay: "0.1s" }}>
                <em style={{ fontStyle: "italic", color: "var(--color-accent-text)" }}>already paid for</em>
              </span>
            </h2>
          </div>
        </div>

        {/* ════ BEAT: closing (light surface card) ════ */}
        <div
          data-beat
          data-center="1.0"
          {...initiallyHidden}
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
              padding: "var(--space-8) var(--space-10) var(--space-7)",
              textAlign: "left",
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-card)",
              boxShadow: "var(--shadow-float)",
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
                  "linear-gradient(118deg, transparent 32%, color-mix(in srgb, var(--color-neutral-0) 55%, transparent) 49%, transparent 60%)",
                opacity: 0.45,
              }}
            />
            <div
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "var(--space-7)",
              }}
            >
              {/* EMV chip */}
              <div
                style={{
                  width: 48,
                  height: 36,
                  borderRadius: "var(--radius-sm)",
                  background: "linear-gradient(135deg, var(--color-accent-subtle), var(--color-accent))",
                  boxShadow: "inset 0 0 0 1px var(--color-border-strong)",
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
                    background: "color-mix(in srgb, var(--color-neutral-900) 20%, transparent)",
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
                    background: "color-mix(in srgb, var(--color-neutral-900) 20%, transparent)",
                    transform: "translateY(-50%)",
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: FB,
                  fontWeight: "var(--weight-semibold)" as unknown as number,
                  fontSize: "var(--text-sm)",
                  letterSpacing: "var(--tracking-widest)",
                  textTransform: "uppercase",
                  color: "var(--color-text-primary)",
                  paddingLeft: "var(--tracking-widest)",
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
                fontWeight: "var(--weight-light)" as unknown as number,
                fontSize: "clamp(var(--text-3xl), 4.4vw, var(--text-4xl))",
                lineHeight: "var(--leading-tight)",
                letterSpacing: "var(--tracking-tight)",
                color: "var(--color-text-primary)",
              }}
            >
              <span data-line style={{ display: "block", ...lineTr, transitionDelay: "0s" }}>
                Go <em style={{ fontStyle: "italic", color: "var(--color-accent-fg)" }}>anywhere</em>
              </span>
            </h2>
            <div data-line style={{ position: "relative", marginTop: "var(--space-6)", ...lineTr, transitionDelay: "0.16s" }}>
              <a
                href="#"
                className="gpx-cta-ink"
                data-mag
                style={{
                  ...CTA_PILL,
                  color: "var(--color-neutral-0)",
                  background: "var(--color-neutral-900)",
                  padding: "var(--space-3) var(--space-6)",
                  boxShadow: "var(--shadow-raised)",
                }}
              >
                start optimizing — free <span style={{ fontSize: "var(--text-sm)" }}>→</span>
              </a>
            </div>
            <div data-line style={{ position: "relative", marginTop: "var(--space-5)", ...lineTr, transitionDelay: "0.26s" }}>
              <span
                style={{
                  fontFamily: FM,
                  fontSize: "var(--text-2xs)",
                  letterSpacing: "var(--tracking-wide)",
                  textTransform: "uppercase",
                  color: "var(--color-text-tertiary)",
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
            bottom: "var(--space-8)",
            left: "7vw",
            zIndex: 30,
            width: 150,
            height: 2,
            background: "color-mix(in srgb, var(--color-text-primary) 14%, transparent)",
            borderRadius: "var(--radius-full)",
            overflow: "hidden",
            animation: "gpxRise 0.9s ease 1.15s both",
          }}
        >
          <div
            data-bar
            style={{
              width: "100%",
              height: "100%",
              background: "var(--color-accent)",
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
            bottom: "var(--space-7)",
            right: "5vw",
            zIndex: 30,
            animation: "gpxRise 0.9s ease 1.15s both",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: "var(--space-2)",
            fontFamily: FS,
            fontSize: "var(--text-xs)",
            fontWeight: "var(--weight-semibold)" as unknown as number,
            letterSpacing: "var(--tracking-wide)",
            textTransform: "uppercase",
            color: "var(--color-text-primary)",
            border: "1px solid var(--color-border-strong)",
            padding: "var(--space-3) var(--space-5)",
            borderRadius: "var(--radius-full)",
            backdropFilter: "var(--blur-sm)",
            transition: "var(--transition-color)",
          }}
        >
          start optimizing <span style={{ fontSize: "var(--text-sm)" }}>→</span>
        </a>

        {/* ════ SCROLL HINT ════ */}
        <div
          data-hint
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: "var(--space-7)",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 30,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "var(--space-2)",
            pointerEvents: "none",
          }}
        >
          <span
            style={{
              fontFamily: FM,
              fontSize: "var(--text-2xs)",
              letterSpacing: "var(--tracking-widest)",
              textTransform: "uppercase",
              color: "var(--color-text-tertiary)",
            }}
          >
            scroll
          </span>
          <div
            style={{
              width: 1,
              height: 26,
              background: "linear-gradient(180deg, color-mix(in srgb, var(--color-text-primary) 55%, transparent), transparent)",
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
            background: "var(--color-bg)",
            pointerEvents: "none",
            animation: "gpxCurtain 1.5s ease 0.15s both",
          }}
        />
      </div>
    </div>
  );
}
