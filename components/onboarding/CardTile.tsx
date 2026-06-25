"use client";

import { useRef, useState } from "react";

import type { CardView } from "@/lib/cards/types";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/**
 * A selectable credit-card tile — big and interactive: a pointer-driven 3D tilt
 * with a cursor-tracking glare, spring hover-lift, and an accent glow-ring on
 * select. The gradient `face`/`accent` are presentational (per-card hex, the
 * scoped exception); the chrome is design-system tokens. Cards stagger in via
 * `index`. The outer wrapper owns the entrance so it doesn't fight the tilt
 * transform on the inner surface.
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
    setTilt({ rx: (0.5 - py) * 12, ry: (px - 0.5) * 16, active: true });
    setGlare({ x: px * 100, y: py * 100 });
  }
  function onLeave() {
    setTilt({ rx: 0, ry: 0, active: false });
    setGlare({ x: 50, y: 50 });
  }

  const transform = `perspective(900px) rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg) translateY(${tilt.active ? -6 : 0}px) scale(${tilt.active ? 1.025 : 1})`;

  return (
    <div
      style={{ opacity: 0, animation: "gpCardIn 0.5s var(--spring-snappy, ease) forwards", animationDelay: `${index * 55}ms` }}
    >
      <button
        ref={ref}
        type="button"
        onClick={() => onToggle(card.id)}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        aria-pressed={selected}
        className="group relative block h-[188px] w-full overflow-hidden rounded-2xl p-5 text-left will-change-transform"
        style={{
          background: card.face,
          transform,
          transition: tilt.active ? "transform 120ms ease-out" : "transform 0.5s var(--spring-snappy, ease), box-shadow 0.28s ease",
          transformStyle: "preserve-3d",
          boxShadow: selected
            ? `0 0 0 2px ${card.accent}, 0 22px 48px -12px ${card.accent}77, var(--shadow-md)`
            : "var(--shadow-raised)",
        }}
      >
        {/* cursor-tracking glare */}
        <span
          className="pointer-events-none absolute inset-0 transition-opacity duration-base"
          style={{
            opacity: tilt.active ? 1 : 0,
            background: `radial-gradient(420px circle at ${glare.x}% ${glare.y}%, rgba(255,255,255,0.18), transparent 45%)`,
          }}
        />
        {/* top sheen + accent rail */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />
        <span className="absolute left-0 top-0 h-full w-1.5" style={{ background: card.accent }} />

        <div className="relative flex h-full flex-col">
          <div className="flex items-start justify-between">
            <div>
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">
                {card.bank}
              </div>
              <div className="mt-1.5 text-lg font-semibold leading-tight text-white/95">
                {card.name}
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-white/40">
                {card.programName}
              </div>
            </div>
            <div
              className="flex h-7 w-7 flex-none items-center justify-center rounded-full transition-all duration-base ease-spring-snappy"
              style={{
                background: selected ? card.accent : "rgba(255,255,255,0.12)",
                boxShadow: selected ? `0 2px 12px ${card.accent}aa` : "none",
                transform: selected ? "scale(1)" : "scale(0.85)",
              }}
            >
              {selected && (
                <span className="text-[13px] leading-none text-white" style={{ animation: "gpCheck 0.4s var(--spring-snappy, ease) both" }}>
                  ✓
                </span>
              )}
            </div>
          </div>

          <div className="mt-auto flex items-end justify-between">
            {/* EMV chip */}
            <span className="relative block h-7 w-10 overflow-hidden rounded-md bg-gradient-to-br from-white/45 to-white/15">
              <span className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-black/15" />
              <span className="absolute bottom-1.5 left-1/2 top-1.5 w-px -translate-x-1/2 bg-black/15" />
            </span>
            <div className="text-right">
              {card.annualFeeCents > 0 ? (
                <div className="font-mono text-[10px] text-white/40">
                  ${Math.round(card.annualFeeCents / 100)}/yr
                </div>
              ) : (
                <div className="font-mono text-[10px] text-white/40">no annual fee</div>
              )}
              <div className="font-mono text-sm font-semibold tracking-tight" style={{ color: card.accent }}>
                {card.rate}
              </div>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}
