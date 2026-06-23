import { FB, FM, FS } from "./cinema";

const STEPS = [
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
];

// Plan rows map to feedback/accent tokens (status hues from the design system).
const PLAN_ROWS = [
  { dot: "var(--color-success)", label: "WALLET", text: "read balances · 180,000 pts", delay: "0.05s", t: "0.55s" },
  { dot: "var(--color-warning)", label: "EARNING", text: "route spend · 3× travel", delay: "0.16s", t: "0.55s" },
  { dot: "var(--color-accent)", label: "REDEEM", text: "transfer → ANA · 1:1", delay: "0.27s", t: "0.55s" },
];

/** "How it works" — left step tabs + right animated stage (driven by the engine). */
export default function HowItWorks() {
  return (
    <section
      id="gpx-how"
      style={{
        position: "relative",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        padding: "var(--space-32) 7vw",
        overflow: "hidden",
        background: "var(--color-bg)",
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
          background: "linear-gradient(180deg, transparent, color-mix(in srgb, var(--color-accent) 65%, transparent))",
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
          background:
            "radial-gradient(ellipse at center, color-mix(in srgb, var(--color-accent) 8%, transparent), transparent 68%)",
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
          gap: "var(--space-20)",
          alignItems: "center",
        }}
      >
        {/* LEFT: steps */}
        <div
          data-reveal
          style={{
            opacity: 0,
            transform: "translateY(var(--space-6))",
            transition:
              "opacity var(--duration-base) var(--ease-soft), transform var(--duration-slow) var(--spring-settle)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", marginBottom: "var(--space-6)" }}>
            <div style={{ width: 30, height: 1, background: "var(--color-accent)" }} />
            <span
              style={{
                fontFamily: FM,
                fontSize: "var(--text-xs)",
                letterSpacing: "var(--tracking-widest)",
                textTransform: "uppercase",
                color: "var(--color-accent-text)",
              }}
            >
              how it works
            </span>
          </div>
          <h2
            style={{
              margin: "0 0 var(--space-10)",
              fontFamily: FB,
              fontWeight: "var(--weight-light)" as unknown as number,
              fontSize: "clamp(var(--text-3xl), 3.8vw, var(--text-4xl))",
              lineHeight: "var(--leading-tight)",
              letterSpacing: "var(--tracking-tight)",
              color: "var(--color-text-primary)",
            }}
          >
            Three steps to
            <br />
            your next trip
          </h2>

          <div data-steps style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {STEPS.map((s, i) => (
              <button
                type="button"
                key={s.n}
                data-step={i}
                aria-pressed={s.active}
                aria-label={`Step ${s.n}: ${s.title}`}
                style={{
                  appearance: "none",
                  margin: 0,
                  font: "inherit",
                  color: "inherit",
                  textAlign: "left",
                  width: "100%",
                  display: "block",
                  cursor: "pointer",
                  padding: "var(--space-5) var(--space-6)",
                  borderRadius: "var(--radius-sm)",
                  border: 0,
                  borderLeft: `2px solid ${s.active ? "var(--color-accent)" : "transparent"}`,
                  background: s.active ? "var(--color-accent-muted)" : "transparent",
                  transition: "var(--transition-color)",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-4)" }}>
                  <span style={{ fontFamily: FM, fontSize: "var(--text-sm)", color: "var(--color-accent-text)", flex: "none" }}>
                    {s.n}
                  </span>
                  <div>
                    <div style={{ fontFamily: FB, fontSize: "var(--text-lg)", color: "var(--color-text-primary)" }}>{s.title}</div>
                    <div
                      style={{
                        fontFamily: FS,
                        fontSize: "var(--text-sm)",
                        color: "var(--color-text-secondary)",
                        marginTop: "var(--space-1)",
                        lineHeight: "var(--leading-normal)",
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
                    background: "color-mix(in srgb, var(--color-text-primary) 12%, transparent)",
                    marginTop: "var(--space-4)",
                    borderRadius: "var(--radius-full)",
                    overflow: "hidden",
                    opacity: s.active ? 1 : 0,
                    transition: "var(--transition-opacity)",
                  }}
                >
                  <div data-stepfill style={{ height: "100%", width: "0%", background: "var(--color-accent)" }} />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* RIGHT: animated stage (decorative illustration of the three steps) */}
        <div
          data-reveal
          data-howstage
          aria-hidden="true"
          style={{
            position: "relative",
            aspectRatio: "4/3",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-card)",
            background: "var(--color-surface)",
            overflow: "hidden",
            boxShadow: "var(--shadow-card)",
            opacity: 0,
            transform: "translateY(var(--space-6))",
            transition:
              "opacity var(--duration-base) var(--ease-soft) 0.12s, transform var(--duration-slow) var(--spring-settle) 0.12s",
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
              transition: "var(--transition-opacity)",
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
                  borderRadius: "var(--radius-lg)",
                  background: "var(--color-surface-raised)",
                  border: "1px solid var(--color-border)",
                  boxShadow: "var(--shadow-md)",
                  padding: "var(--space-4)",
                  opacity: 0,
                  transform: "translate(-96px,52px) rotate(-10deg)",
                  transition:
                    "opacity var(--duration-base) var(--ease-soft) 0.05s, transform var(--duration-slow) var(--spring-settle) 0.05s",
                  overflow: "hidden",
                }}
              >
                <div style={{ position: "absolute", top: 0, left: 0, width: 4, height: "100%", background: "var(--color-iris-400)" }} />
                <div style={{ width: 30, height: 22, borderRadius: "var(--radius-xs)", background: "linear-gradient(135deg, var(--color-accent-subtle), var(--color-accent))" }} />
                <div style={{ position: "absolute", bottom: 15, left: 16, fontFamily: FM, fontSize: "var(--text-2xs)", color: "var(--color-text-tertiary)" }}>
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
                  borderRadius: "var(--radius-lg)",
                  background: "var(--color-surface-raised)",
                  border: "1px solid var(--color-border)",
                  boxShadow: "var(--shadow-md)",
                  padding: "var(--space-4)",
                  opacity: 0,
                  transform: "translate(96px,52px) rotate(10deg)",
                  transition:
                    "opacity var(--duration-base) var(--ease-soft) 0.18s, transform var(--duration-slow) var(--spring-settle) 0.18s",
                  overflow: "hidden",
                }}
              >
                <div style={{ position: "absolute", top: 0, left: 0, width: 4, height: "100%", background: "var(--color-accent)" }} />
                <div style={{ width: 30, height: 22, borderRadius: "var(--radius-xs)", background: "linear-gradient(135deg, var(--color-accent-subtle), var(--color-accent))" }} />
                <div style={{ position: "absolute", bottom: 15, left: 16, fontFamily: FM, fontSize: "var(--text-2xs)", color: "var(--color-text-tertiary)" }}>
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
                  borderRadius: "var(--radius-lg)",
                  background: "var(--color-surface)",
                  border: "1px solid var(--color-border-strong)",
                  boxShadow: "var(--shadow-lg)",
                  padding: "var(--space-4)",
                  opacity: 0,
                  transform: "translate(0,44px) rotate(-1deg)",
                  transition:
                    "opacity var(--duration-base) var(--ease-soft) 0.3s, transform var(--duration-slow) var(--spring-settle) 0.3s",
                  overflow: "hidden",
                }}
              >
                <div style={{ position: "absolute", top: 0, left: 0, width: 4, height: "100%", background: "var(--color-accent)" }} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ width: 32, height: 23, borderRadius: "var(--radius-xs)", background: "linear-gradient(135deg, var(--color-accent-subtle), var(--color-accent))" }} />
                  <span style={{ fontFamily: FM, fontSize: "var(--text-2xs)", letterSpacing: "var(--tracking-wider)", color: "var(--color-text-tertiary)" }}>
                    PRIMARY
                  </span>
                </div>
                <div style={{ position: "absolute", bottom: 15, left: 17, fontFamily: FM, fontSize: "var(--text-2xs)", color: "var(--color-text-secondary)" }}>
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
              transition: "var(--transition-opacity)",
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
                    "opacity var(--duration-base) var(--ease-soft) 0.05s, transform var(--duration-slow) var(--spring-settle) 0.05s",
                  background: "var(--color-surface-subtle)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-lg)",
                  padding: "var(--space-5) var(--space-5) var(--space-4)",
                }}
              >
                <div
                  style={{
                    fontFamily: FM,
                    fontSize: "var(--text-2xs)",
                    letterSpacing: "var(--tracking-wider)",
                    textTransform: "uppercase",
                    color: "var(--color-text-tertiary)",
                    marginBottom: "var(--space-3)",
                  }}
                >
                  your goal
                </div>
                <div
                  style={{
                    fontFamily: FB,
                    fontStyle: "italic",
                    fontSize: "var(--text-lg)",
                    lineHeight: "var(--leading-snug)",
                    color: "var(--color-text-primary)",
                    minHeight: 66,
                  }}
                >
                  <span data-howtyper>
                    <span />
                    <span style={{ color: "var(--color-accent)", animation: "gpxCaret 1s step-end infinite" }}>▍</span>
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
                    "opacity var(--duration-base) var(--ease-soft) 0.22s, transform var(--duration-slow) var(--spring-settle) 0.22s",
                  marginTop: "var(--space-4)",
                  display: "flex",
                  justifyContent: "flex-end",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    fontFamily: FS,
                    fontSize: "var(--text-xs)",
                    fontWeight: "var(--weight-semibold)" as unknown as number,
                    letterSpacing: "var(--tracking-wide)",
                    textTransform: "uppercase",
                    color: "var(--color-neutral-0)",
                    background: "var(--color-accent)",
                    padding: "var(--space-3) var(--space-6)",
                    borderRadius: "var(--radius-full)",
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
              transition: "var(--transition-opacity)",
            }}
          >
            <div style={{ width: "82%", maxWidth: 460 }}>
              {PLAN_ROWS.map((r) => (
                <div
                  key={r.label}
                  data-anim
                  data-final="translateY(0)"
                  data-hidden="translateY(22px)"
                  style={{
                    opacity: 0,
                    transform: "translateY(22px)",
                    transition: `opacity ${r.t} var(--ease-soft) ${r.delay}, transform var(--duration-slow) var(--spring-settle) ${r.delay}`,
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-3)",
                    padding: "var(--space-3) var(--space-4)",
                    background: "var(--color-surface-subtle)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "var(--radius-md)",
                    marginBottom: "var(--space-2)",
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: "var(--radius-xs)", background: r.dot, flex: "none" }} />
                  <span style={{ fontFamily: FM, fontSize: "var(--text-2xs)", fontWeight: "var(--weight-semibold)" as unknown as number, color: r.dot, width: 62, flex: "none" }}>
                    {r.label}
                  </span>
                  <span style={{ fontFamily: FM, fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", flex: 1 }}>
                    {r.text}
                  </span>
                  <span style={{ color: "var(--color-success)", fontSize: "var(--text-sm)" }}>✓</span>
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
                    "opacity 0.55s var(--ease-soft) 0.4s, transform var(--duration-slow) var(--spring-settle) 0.4s",
                  marginTop: "var(--space-4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "var(--space-4) var(--space-5)",
                  background: "var(--color-accent-muted)",
                  border: "1px solid var(--color-accent-subtle)",
                  borderRadius: "var(--radius-lg)",
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: FM,
                      fontSize: "var(--text-2xs)",
                      letterSpacing: "var(--tracking-wider)",
                      textTransform: "uppercase",
                      color: "var(--color-accent-fg)",
                    }}
                  >
                    your plan
                  </div>
                  <div style={{ fontFamily: FB, fontSize: "var(--text-md)", color: "var(--color-text-primary)", marginTop: "var(--space-1)" }}>
                    Business saver · LAX → TYO
                  </div>
                </div>
                <div style={{ fontFamily: FB, fontSize: "var(--text-xl)", color: "var(--color-accent-text)" }}>120k</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
