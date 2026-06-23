import { CTA_PILL, FB, FM } from "./cinema";

/** Closing footer: final CTA + wordmark + meta line. */
export default function SiteFooter() {
  return (
    <footer
      style={{
        position: "relative",
        background: "var(--color-bg)",
        borderTop: "1px solid var(--color-border)",
        padding: "var(--space-20) 7vw var(--space-12)",
        color: "var(--color-text-primary)",
      }}
    >
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-12) var(--space-16)",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div style={{ maxWidth: 440 }}>
            <h2
              style={{
                margin: "0 0 var(--space-6)",
                fontFamily: FB,
                fontWeight: "var(--weight-light)" as unknown as number,
                fontSize: "clamp(var(--text-2xl), 2.8vw, var(--text-3xl))",
                lineHeight: "var(--leading-snug)",
                letterSpacing: "var(--tracking-tight)",
                color: "var(--color-text-primary)",
              }}
            >
              Your next trip is
              <br />
              one scroll away.
            </h2>
            <a
              href="#gpx-how"
              className="gpx-cta-gilt"
              data-mag
              style={{
                ...CTA_PILL,
                color: "var(--color-neutral-0)",
                background: "var(--color-accent)",
                padding: "var(--space-3) var(--space-6)",
              }}
            >
              start optimizing — free <span style={{ fontSize: "var(--text-sm)" }}>→</span>
            </a>
          </div>
        </div>
        <div style={{ height: 1, background: "var(--color-border)", margin: "var(--space-12) 0 var(--space-6)" }} />
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "var(--space-4)",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
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
            <span style={{ width: 5, height: 5, borderRadius: "var(--radius-full)", background: "var(--color-accent)" }} />
          </div>
          <span style={{ fontFamily: FM, fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)", letterSpacing: "var(--tracking-wide)" }}>
            coordination is state, not messages
          </span>
          <span style={{ fontFamily: FM, fontSize: "var(--text-xs)", color: "var(--color-text-tertiary)" }}>© 2026 GPFree</span>
        </div>
      </div>
    </footer>
  );
}
