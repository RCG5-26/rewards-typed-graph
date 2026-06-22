import { CTA_PILL, FB, FM } from "./cinema";

/** Closing footer: final CTA + wordmark + meta line. */
export default function SiteFooter() {
  return (
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
            <h2
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
            </h2>
            <a
              href="#"
              className="gpx-cta-gilt"
              data-mag
              style={{ ...CTA_PILL, color: "#0C0A07", background: "#C8A35E", padding: "15px 30px" }}
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
  );
}
