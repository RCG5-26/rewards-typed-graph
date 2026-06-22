import {
  beatHeadStyle,
  CTA_PILL,
  FB,
  FM,
  FRAMES,
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
          background: "#0C0A07",
        }}
      >
        {/* ════ SOFT FRAME DISSOLVE (opacity crossfade only — no zoom) ════ */}
        <div style={{ position: "absolute", inset: 0 }}>
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

        {/* ════ POINTER-REACTIVE LIGHT ════ */}
        <div
          data-glow
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            pointerEvents: "none",
            mixBlendMode: "screen",
            opacity: 0,
            transition: "opacity 0.7s ease",
            background:
              "radial-gradient(360px circle at var(--gx,50%) var(--gy,42%), rgba(200,163,94,0.22), rgba(150,175,255,0.07) 42%, transparent 72%)",
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

        {/* ════ COPY SCRIM (left column legibility) ════ */}
        {/* Sits below the beats (z 20) but above the imagery so the light
            headline/CTA stay readable over any frame, without darkening the
            card on the right. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 15,
            pointerEvents: "none",
            background:
              "linear-gradient(90deg, rgba(12,10,7,0.78) 0%, rgba(12,10,7,0.5) 26%, rgba(12,10,7,0) 56%)",
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
              opacity: 0.07,
              mixBlendMode: "overlay",
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
          <div style={{ padding: "0 7vw", maxWidth: 920 }}>
            <h1 style={beatHeadStyle}>
              <span data-line style={{ display: "block", ...lineTr, transitionDelay: "0s" }}>
                Your points are worth
              </span>
              <span data-line style={{ display: "block", ...lineTr, transitionDelay: "0.1s" }}>
                <em style={{ fontStyle: "italic", color: "#C8A35E" }}>more</em> than you think
              </span>
            </h1>
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
                data-mag
                style={{ ...CTA_PILL, color: "#0C0A07", background: "#F2EADD", padding: "16px 32px" }}
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
          {...initiallyHidden}
          style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "center", opacity: 0 }}
        >
          <div style={{ padding: "0 7vw", maxWidth: 920 }}>
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
          {...initiallyHidden}
          style={{ position: "absolute", inset: 0, zIndex: 20, display: "flex", alignItems: "center", opacity: 0 }}
        >
          <div style={{ padding: "0 7vw", maxWidth: 920 }}>
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
                data-mag
                style={{
                  ...CTA_PILL,
                  color: "#F7F2E9",
                  background: "#14110B",
                  padding: "15px 30px",
                  boxShadow: "0 12px 34px rgba(0,0,0,0.28)",
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
          aria-hidden="true"
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
  );
}
