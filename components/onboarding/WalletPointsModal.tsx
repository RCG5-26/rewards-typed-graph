"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { CardView } from "@/lib/cards/types";

/**
 * Wallet points modal — opened from the wallet picker. For each card the user
 * carries, it collects how many points they hold, then hands the per-card map
 * back to the parent (which sums per program and submits to the API).
 *
 * Styled to match the onboarding surface: light `bg-surface` panel, design-token
 * chrome, and a row per card reusing the card's presentational `face`/`accent`
 * so the modal reads as a continuation of the wallet rail.
 */
export default function WalletPointsModal({
  cards,
  initialByCard = {},
  onClose,
  onSubmit,
}: {
  cards: CardView[];
  /** Previously entered points keyed by `card.id`, for re-open prefill. */
  initialByCard?: Record<string, number>;
  onClose: () => void;
  /** Persist the per-card points. May reject to surface an error in the modal. */
  onSubmit: (pointsByCardId: Record<string, number>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      cards.map((c) => [c.id, initialByCard[c.id] ? String(initialByCard[c.id]) : ""]),
    ),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const total = useMemo(
    () => cards.reduce((sum, c) => sum + (parseInt(values[c.id] ?? "", 10) || 0), 0),
    [cards, values],
  );

  function setValue(id: string, raw: string) {
    // Keep only digits — points are whole, non-negative.
    setValues((prev) => ({ ...prev, [id]: raw.replace(/[^0-9]/g, "") }));
  }

  async function handleSubmit() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const pointsByCardId: Record<string, number> = {};
    for (const card of cards) {
      pointsByCardId[card.id] = parseInt(values[card.id] ?? "", 10) || 0;
    }
    try {
      await onSubmit(pointsByCardId);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save your points. Try again.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-points-title"
    >
      {/* backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={() => !submitting && onClose()}
        className="absolute inset-0 bg-neutral-950/55"
        style={{ backdropFilter: "blur(6px)", animation: "gp-step-in 0.2s ease both" }}
      />

      <div
        className="relative flex max-h-[88vh] w-full max-w-[480px] flex-col overflow-hidden rounded-card bg-surface shadow-float ring-1 ring-border"
        style={{ animation: "gp-card-in 0.4s var(--spring-snappy, ease) both" }}
      >
        <span className="absolute left-0 top-0 h-full w-1 bg-accent" />

        {/* header */}
        <div className="flex items-start justify-between px-6 pb-4 pt-6">
          <div>
            <div className="font-mono text-2xs font-semibold uppercase tracking-[0.18em] text-accent-text">
              your points
            </div>
            <h2
              id="wallet-points-title"
              className="mt-1.5 font-display text-2xl font-semibold uppercase leading-[0.98] tracking-snug text-text-primary"
            >
              how many points
              <br />
              do you have?
            </h2>
            <p className="mt-2 max-w-[340px] text-sm leading-relaxed text-text-secondary">
              enter the balance you hold on each card — the agents plan against your
              real points.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !submitting && onClose()}
            aria-label="Close"
            className="-mr-1.5 -mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-full text-text-tertiary transition hover:bg-surface-subtle hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        {/* per-card rows */}
        <div className="flex-1 space-y-3 overflow-y-auto px-6 pb-2">
          {cards.map((card) => (
            <div
              key={card.id}
              className="flex items-center gap-3 rounded-xl bg-surface-subtle p-3 ring-1 ring-subtle"
            >
              {/* mini card face */}
              <div
                className="relative h-11 w-16 flex-none overflow-hidden rounded-lg ring-1 ring-black/10"
                style={{ background: card.face }}
              >
                <span
                  className="absolute left-0 top-0 h-full w-1"
                  style={{ background: card.accent }}
                />
                <span className="absolute bottom-1.5 left-2 h-3 w-4 rounded-sm bg-gradient-to-br from-white/45 to-white/15" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-text-primary">
                  {card.name}
                </div>
                <div className="truncate font-mono text-2xs uppercase tracking-wide text-text-tertiary">
                  {card.programName}
                </div>
              </div>
              <div className="flex flex-none items-center gap-1.5">
                <input
                  ref={card === cards[0] ? firstInputRef : undefined}
                  type="text"
                  inputMode="numeric"
                  value={values[card.id] ?? ""}
                  onChange={(e) => setValue(card.id, e.target.value)}
                  placeholder="0"
                  aria-label={`Points on ${card.name}`}
                  disabled={submitting}
                  className="w-24 rounded-lg bg-surface px-3 py-2 text-right font-mono text-sm tabular-nums text-text-primary shadow-xs outline-none ring-1 ring-border transition focus:ring-2 focus:ring-accent disabled:opacity-50"
                />
                <span className="w-9 font-mono text-2xs text-text-tertiary">
                  {card.currencyName}
                </span>
              </div>
            </div>
          ))}
        </div>

        {error && (
          <div className="mx-6 mt-2 rounded-lg bg-error-bg px-3 py-2 text-xs text-error-fg">
            {error}
          </div>
        )}

        {/* footer */}
        <div className="flex items-center justify-between gap-3 px-6 pb-6 pt-4">
          <div className="font-mono text-2xs uppercase tracking-wide text-text-tertiary">
            total{" "}
            <span className="text-text-secondary tabular-nums">
              {total.toLocaleString("en-US")}
            </span>{" "}
            pts
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="group flex items-center justify-center gap-2 rounded-full bg-neutral-900 px-5 py-3 text-base font-medium text-white shadow-lg transition duration-base ease-spring-snappy hover:-translate-y-0.5 hover:shadow-float disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {submitting ? "saving…" : "save points"}
            {!submitting && (
              <span className="transition-transform duration-base group-hover:translate-x-0.5">
                →
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
