"use client";

import type { CardView } from "@/lib/cards/types";

/**
 * A selectable credit-card tile, ported from the GPFree Onboarding design.
 *
 * The gradient `face` and `accent` are presentational (per-card hex from the
 * presentation map — the same scoped hardcoded-color exception as the hero);
 * the surrounding chrome (ring, radius, shadow, motion) uses design-system
 * tokens via the Tailwind preset.
 */
export default function CardTile({
  card,
  selected,
  onToggle,
}: {
  card: CardView;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(card.id)}
      aria-pressed={selected}
      className="relative h-[118px] overflow-hidden rounded-xl p-4 text-left shadow-raised outline-offset-2 transition duration-base ease-spring-snappy hover:-translate-y-1"
      style={{
        background: card.face,
        outline: `2px solid ${selected ? card.accent : "transparent"}`,
        opacity: selected ? 1 : 0.92,
      }}
    >
      <span
        className="absolute left-0 top-0 h-full w-1"
        style={{ background: card.accent }}
      />
      <div className="text-2xs font-semibold uppercase tracking-wider text-white/50">
        {card.bank}
      </div>
      <div className="mt-1 text-base font-medium leading-tight text-white/95">
        {card.name}
      </div>
      {/* EMV chip */}
      <div className="absolute bottom-3.5 left-4 h-[22px] w-[30px] rounded-[5px] bg-gradient-to-br from-white/40 to-white/15" />
      <div
        className="absolute bottom-3.5 right-4 text-xs font-semibold"
        style={{ color: card.accent }}
      >
        {card.rate}
      </div>

      {selected && (
        <div
          className="absolute right-3 top-3 flex h-[22px] w-[22px] items-center justify-center rounded-full text-white shadow-md"
          style={{ background: card.accent }}
        >
          <span className="text-xs leading-none">✓</span>
        </div>
      )}
    </button>
  );
}
