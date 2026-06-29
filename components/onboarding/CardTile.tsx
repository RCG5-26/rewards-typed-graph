"use client";

import { useRef, useState } from "react";

import type { CardView } from "@/lib/cards/types";
import { useReducedMotion } from "@/lib/use-reduced-motion";

const PROGRAM_DESCRIPTOR: Record<string, string> = {
  "Chase Ultimate Rewards": "transfers to Hyatt, United & more",
  "World of Hyatt": "earn Hyatt points · book hotels directly",
  "United MileagePlus": "fly United & Star Alliance partners",
};

/** Gold EMV chip — shared visual language with the landing hero card. */
function EmvChip({ className = "" }: { className?: string }) {
  return (
    <span
      className={`relative block overflow-hidden rounded-md ${className}`}
      style={{
        background: "linear-gradient(135deg, var(--card-chip-gold-1), var(--card-chip-gold-2))",
        boxShadow:
          "0 1px 2px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(0,0,0,0.3) inset",
      }}
      aria-hidden="true"
    >
      <span className="absolute bottom-1.5 left-1/2 top-1.5 w-px -translate-x-1/2 bg-[rgba(60,40,10,0.45)]" />
      <span className="absolute left-1.5 right-1.5 top-1/2 h-px -translate-y-1/2 bg-[rgba(60,40,10,0.45)]" />
      <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-[rgba(60,40,10,0.4)]" />
    </span>
  );
}

/**
 * A selectable credit-card tile — premium metal treatment (brushed texture, gold
 * chip, glint sweep, iris edge glow) matching the landing hero card. Pointer tilt
 * + cursor glare; icy highlight ring on select.
 */
export default function CardTile({
  card,
  selected,
  index,
  onToggle,
}: {
  card: CardView;
  selected: boolean;
  index: number;
  onToggle: (id: string) => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [tilt, setTilt] = useState({ rx: 0, ry: 0, active: false });
  const [glare, setGlare] = useState({ x: 50, y: 50 });
  const reduced = useReducedMotion();

  function onMove(e: React.MouseEvent<HTMLButtonElement>) {
    if (reduced) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    setTilt({ rx: (0.5 - py) * 8, ry: (px - 0.5) * 11, active: true });
    setGlare({ x: px * 100, y: py * 100 });
  }
  function onLeave() {
    setTilt({ rx: 0, ry: 0, active: false });
    setGlare({ x: 50, y: 50 });
  }

  const transform = `perspective(900px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) translateY(${tilt.active ? -4 : 0}px) scale(${tilt.active ? 1.015 : 1})`;

  return (
    <div
      style={{
        opacity: 0,
        animation: "gp-card-in 0.5s var(--spring-snappy, ease) forwards",
        animationDelay: `${index * 55}ms`,
      }}
    >
      <button
        ref={ref}
        type="button"
        onClick={() => onToggle(card.slug)}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        aria-pressed={selected}
        className="group relative block h-[188px] w-full overflow-hidden rounded-2xl p-5 text-left will-change-transform"
        style={{
          background: card.face,
          transform,
          transition: tilt.active
            ? "transform 120ms ease-out"
            : "transform 0.5s var(--spring-snappy, ease), box-shadow 0.28s ease",
          transformStyle: "preserve-3d",
          boxShadow: selected
            ? "0 0 0 2px var(--color-highlight), 0 22px 48px -12px color-mix(in srgb, var(--color-highlight-glow) 55%, transparent), var(--shadow-md)"
            : "0 14px 32px -10px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.07) inset",
        }}
      >
        {/* brushed metal texture */}
        <span
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            background:
              "repeating-linear-gradient(115deg, var(--card-brush-line) 0px, var(--card-brush-line) 1px, transparent 2px, transparent 4px)",
          }}
        />
        {/* diagonal glint sweep */}
        {!reduced && (
          <span
            className="pointer-events-none absolute -top-[30%] left-0 h-[160%] w-[34%] mix-blend-overlay"
            style={{
              background: `linear-gradient(90deg, transparent, var(--card-sheen), transparent)`,
              filter: "blur(5px)",
              animation: "gp-glint 7.5s ease-in-out 2.4s infinite",
            }}
          />
        )}
        {/* iris edge glow */}
        <span
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{
            boxShadow: `0 0 28px color-mix(in srgb, var(--card-edge-glow) 60%, transparent) inset`,
          }}
        />
        {/* cursor-tracking glare */}
        <span
          className="pointer-events-none absolute inset-0 transition-opacity duration-base"
          style={{
            opacity: tilt.active ? 1 : 0,
            background: `radial-gradient(420px circle at ${glare.x}% ${glare.y}%, rgba(255,255,255,0.22), transparent 45%)`,
            mixBlendMode: "soft-light",
          }}
        />
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />
        <span className="absolute left-0 top-0 h-full w-1.5" style={{ background: card.accent }} />

        <div className="relative flex h-full flex-col">
          <div className="flex items-start justify-between">
            <div>
              <div
                className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50"
                style={{ textShadow: "0 1px 0 rgba(0,0,0,0.35)" }}
              >
                {card.bank}
              </div>
              <div
                className="mt-1.5 text-lg font-semibold leading-tight text-white/95"
                style={{ textShadow: "0 1px 0 rgba(0,0,0,0.28), 0 -1px 0 rgba(255,255,255,0.12)" }}
              >
                {card.name}
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-white/65">
                {card.programName}
              </div>
              <div className="mt-0.5 text-[10px] leading-tight text-white/45">
                {PROGRAM_DESCRIPTOR[card.programName] ?? ""}
              </div>
            </div>
            <div
              className="flex h-7 w-7 flex-none items-center justify-center rounded-full transition-all duration-base ease-spring-snappy"
              style={{
                background: selected ? "var(--color-highlight)" : "rgba(255,255,255,0.12)",
                boxShadow: selected
                  ? "0 2px 12px color-mix(in srgb, var(--color-highlight-glow) 70%, transparent)"
                  : "none",
                transform: selected ? "scale(1)" : "scale(0.85)",
              }}
            >
              {selected && (
                <span
                  className="text-[13px] leading-none text-on-highlight"
                  style={{ animation: "gp-check 0.4s var(--spring-snappy, ease) both" }}
                >
                  ✓
                </span>
              )}
            </div>
          </div>

          <div className="mt-auto flex items-end justify-between">
            <EmvChip className="h-7 w-10" />
            <div className="text-right">
              {card.annualFeeCents > 0 ? (
                <div className="font-mono text-[10px] text-white/40">
                  ${Math.round(card.annualFeeCents / 100)}/yr
                </div>
              ) : (
                <div className="font-mono text-[10px] text-white/40">no annual fee</div>
              )}
              <div
                className="font-mono text-sm font-semibold tracking-tight"
                style={{ color: card.accent }}
              >
                {card.rate}
              </div>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}
