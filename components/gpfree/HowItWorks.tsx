import { FB, FM } from "./cinema";

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

const PLAN_ROWS = [
  { dot: "#1f9d8f", label: "WALLET", text: "read balances · 180,000 pts", delay: "0.05s", t: "0.55s" },
  { dot: "#bd8a2e", label: "EARNING", text: "route spend · 3× travel", delay: "0.16s", t: "0.55s" },
  { dot: "#4f7cf0", label: "REDEEM", text: "transfer → ANA · 1:1", delay: "0.27s", t: "0.55s" },
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
                  padding: "18px 22px",
                  borderRadius: 5,
                  border: 0,
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
              {PLAN_ROWS.map((r) => (
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
  );
}
