"use client";

import { useEffect, useMemo, useState } from "react";

import type { CardView } from "@/lib/cards/types";
import type { UserGraph } from "@/lib/user/types";
import AgentConsole from "./AgentConsole";
import CardTile from "./CardTile";

type Step = "cards" | "ask" | "plan";

const SUGGESTED_PROMPTS = [
  { tag: "✈", text: "fly LAX → Tokyo in business this fall using my points" },
  { tag: "★", text: "hit the welcome bonus before the deadline" },
  { tag: "%", text: "most cashback on everyday spend" },
  { tag: "◎", text: "save a 3-night Tokyo hotel stay on points" },
];

function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/**
 * GPFree onboarding — the post-sign-in flow: pick the cards you carry, then ask
 * the agents in plain words. Cards are the real demo seed (via `/api/cards`).
 * The agent console + typed-graph traversal are the next pass; this lands the
 * pick-cards + ask surfaces from the GPFree Onboarding design against live data.
 */
export default function OnboardingFlow() {
  const [cards, setCards] = useState<CardView[]>([]);
  const [me, setMe] = useState<UserGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [step, setStep] = useState<Step>("cards");
  const [query, setQuery] = useState("");

  // The console opens the SSE plan stream itself; here we just transition.
  function goToPlan() {
    if (!query.trim()) return;
    setStep("plan");
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/cards").then((r) => {
        if (!r.ok) throw new Error(`cards HTTP ${r.status}`);
        return r.json() as Promise<{ cards: CardView[] }>;
      }),
      // /api/me is best-effort: the flow still works if the personal graph
      // can't be resolved, it just won't pre-fill the wallet/goal.
      fetch("/api/me")
        .then((r) => (r.ok ? (r.json() as Promise<UserGraph>) : null))
        .catch(() => null),
    ])
      .then(([cardsData, graph]) => {
        if (!active) return;
        setCards(cardsData.cards);
        if (graph) {
          setMe(graph);
          // Pre-select the cards the user already holds (real `holds` rows),
          // intersected with the catalog we actually loaded.
          const catalog = new Set(cardsData.cards.map((c) => c.id));
          setSelected(graph.holds.map((h) => h.cardId).filter((id) => catalog.has(id)));
          // Seed the goal box from the user's stored goal.
          const goal = graph.goals[0];
          if (goal?.description) setQuery(goal.description);
        }
      })
      .catch((err) => {
        console.error("onboarding load failed", err);
        if (active) setError("Could not load your cards. Try again.");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const pointsOnHand = useMemo(
    () => (me ? me.balances.reduce((sum, b) => sum + b.balancePoints, 0) : 0),
    [me],
  );
  const firstName = me?.user.displayName?.split(" ")[0] ?? null;

  const wallet = useMemo(
    () => cards.filter((c) => selected.includes(c.id)),
    [cards, selected],
  );
  const projectedCents = useMemo(
    () => wallet.reduce((sum, c) => sum + c.firstYearValueCents, 0),
    [wallet],
  );

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const cardWord = wallet.length === 1 ? "card" : "cards";

  return (
    <main className="relative h-screen w-full overflow-hidden bg-surface-subtle">
      {/* ambient glows */}
      <div className="pointer-events-none absolute -bottom-44 -right-36 h-[520px] w-[520px] rounded-full bg-[var(--blob-glow-lg,radial-gradient(circle,var(--color-blob-core),transparent_72%))] opacity-60" />
      <div className="pointer-events-none absolute -left-32 -top-32 h-[420px] w-[420px] rounded-full bg-[var(--blob-glow-lg,radial-gradient(circle,var(--color-blob-core),transparent_72%))] opacity-40" />

          {step === "cards" && (
            <CardsStep
              cards={cards}
              loading={loading}
              error={error}
              selected={selected}
              wallet={wallet}
              projectedCents={projectedCents}
              cardWord={cardWord}
              firstName={firstName}
              pointsOnHand={pointsOnHand}
              prefilledCount={me?.holds.length ?? 0}
              onToggle={toggle}
              onContinue={() => setStep("ask")}
            />
          )}

          {step === "ask" && (
            <AskStep
              walletCount={wallet.length}
              cardWord={cardWord}
              query={query}
              setQuery={setQuery}
              onBack={() => setStep("cards")}
              onPlan={goToPlan}
              prompts={SUGGESTED_PROMPTS}
            />
          )}

          {step === "plan" && (
            <AgentConsole
              queryText={query.trim()}
              selectedCardIds={selected}
              onRestart={() => setStep("cards")}
            />
          )}
    </main>
  );
}

// ── Step 1 · pick cards ──────────────────────────────────────────────
function CardsStep({
  cards,
  loading,
  error,
  selected,
  wallet,
  projectedCents,
  cardWord,
  firstName,
  pointsOnHand,
  prefilledCount,
  onToggle,
  onContinue,
}: {
  cards: CardView[];
  loading: boolean;
  error: string | null;
  selected: string[];
  wallet: CardView[];
  projectedCents: number;
  cardWord: string;
  firstName: string | null;
  pointsOnHand: number;
  prefilledCount: number;
  onToggle: (id: string) => void;
  onContinue: () => void;
}) {
  const hasCards = wallet.length > 0;

  return (
    <div className="absolute inset-0 z-[2] flex pt-11">
      {/* left — catalog */}
      <div className="flex min-w-0 flex-1 flex-col px-8 pb-7 pl-11 pt-2">
        <h1 className="font-display text-2xl font-semibold uppercase leading-tight tracking-snug text-text-primary">
          {firstName ? `welcome back, ${firstName}.` : "which cards do you carry?"}
        </h1>
        <p className="mb-4 mt-1.5 text-sm text-text-tertiary">
          {prefilledCount > 0
            ? `we found ${prefilledCount} ${prefilledCount === 1 ? "card" : "cards"} on your account — tap to adjust your wallet`
            : "tap a card to drop it in your wallet"}
        </p>

        <div className="-mr-1.5 flex-1 overflow-y-auto pr-2.5">
          {loading && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[118px] animate-pulse rounded-xl bg-neutral-200"
                />
              ))}
            </div>
          )}
          {error && (
            <div className="rounded-lg bg-error-bg px-4 py-3 text-sm text-error-fg">
              {error}
            </div>
          )}
          {!loading && !error && (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
              {cards.map((card) => (
                <CardTile
                  key={card.id}
                  card={card}
                  selected={selected.includes(card.id)}
                  onToggle={onToggle}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* right — wallet */}
      <aside className="flex w-[330px] flex-none flex-col border-l border-subtle bg-[var(--glass-light)] px-7 py-6 backdrop-blur-md">
        <div className="font-display text-xs font-semibold uppercase tracking-widest text-text-tertiary">
          your wallet
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-display text-5xl font-semibold leading-none text-text-primary">
            {wallet.length}
          </span>
          <span className="text-sm text-text-secondary">{cardWord}</span>
        </div>
        {pointsOnHand > 0 && (
          <div className="mt-1.5 font-mono text-xs text-text-tertiary">
            {pointsOnHand.toLocaleString("en-US")} pts on hand
          </div>
        )}

        {/* stacked wallet preview */}
        <div className="relative my-4 flex-1">
          {hasCards ? (
            <div className="relative h-full">
              {wallet.map((w, i) => (
                <div
                  key={w.id}
                  className="absolute left-1/2 h-[148px] w-[236px] -translate-x-1/2 overflow-hidden rounded-lg p-4 shadow-float transition-all duration-base"
                  style={{
                    top: `${i * 30}px`,
                    background: w.face,
                    zIndex: i,
                    transform: `translateX(-50%) rotate(${i % 2 === 0 ? -2 : 2}deg)`,
                  }}
                >
                  <span
                    className="absolute left-0 top-0 h-full w-1"
                    style={{ background: w.accent }}
                  />
                  <div className="text-2xs font-semibold uppercase tracking-wider text-white/50">
                    {w.bank}
                  </div>
                  <div className="mt-1 text-base font-medium text-white/95">
                    {w.name}
                  </div>
                  <div
                    className="absolute bottom-4 right-4 text-xs font-semibold"
                    style={{ color: w.accent }}
                  >
                    {w.rate}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex h-[148px] w-[236px] items-center justify-center rounded-lg border border-dashed border-strong text-center">
                <span className="max-w-[150px] text-sm text-text-tertiary">
                  your wallet is empty — tap a card to begin
                </span>
              </div>
            </div>
          )}
        </div>

        {/* projected value */}
        <div className="mb-3.5 rounded-card bg-surface p-4 shadow-sm">
          <div className="font-display text-2xs font-semibold uppercase tracking-wide text-text-tertiary">
            projected first-year value
          </div>
          <div className="mt-1.5 flex items-baseline gap-1.5">
            <span className="font-display text-2xl font-semibold leading-none text-text-primary">
              {dollars(projectedCents)}
            </span>
            <span className="text-xs text-text-secondary">est. net of fees</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onContinue}
          disabled={!hasCards}
          className="flex items-center justify-center gap-2 rounded-full bg-neutral-900 px-4 py-3.5 text-base font-medium text-white shadow-lg transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
        >
          continue →
        </button>
      </aside>
    </div>
  );
}

// ── Step 2 · ask (natural-language query) ────────────────────────────
function AskStep({
  walletCount,
  cardWord,
  query,
  setQuery,
  onBack,
  onPlan,
  prompts,
}: {
  walletCount: number;
  cardWord: string;
  query: string;
  setQuery: (v: string) => void;
  onBack: () => void;
  onPlan: () => void;
  prompts: { tag: string; text: string }[];
}) {
  const ready = query.trim().length > 0;
  return (
    <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center px-14 pb-9 pt-12">
      <div className="w-full max-w-[680px]">
        <h1 className="font-display text-3xl font-semibold uppercase leading-tight tracking-snug text-text-primary">
          what do you want
          <br />
          your points to do?
        </h1>
        <p className="mb-6 mt-3 max-w-[460px] text-sm leading-relaxed text-text-secondary">
          describe the trip or goal in a sentence — the agents turn it into a
          typed plan across your {walletCount} {cardWord}.
        </p>

        <div className="flex items-end gap-3 rounded-2xl bg-surface py-2 pl-5 pr-2 shadow-lg ring-2 ring-accent-subtle">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. fly LAX → Tokyo in business this fall using my points"
            rows={2}
            className="min-w-0 flex-1 resize-none bg-transparent py-3.5 text-md leading-normal text-text-primary outline-none placeholder:text-text-tertiary"
          />
          <button
            type="button"
            onClick={onPlan}
            disabled={!ready}
            className="h-12 flex-none self-end whitespace-nowrap rounded-lg bg-neutral-900 px-5 text-base font-medium text-white shadow-md transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
          >
            plan it →
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {prompts.map((p) => (
            <button
              key={p.text}
              type="button"
              onClick={() => setQuery(p.text)}
              className="flex items-center gap-1.5 rounded-full border border-DEFAULT bg-surface px-3.5 py-2 text-sm font-medium text-text-secondary transition hover:-translate-y-px"
            >
              <span className="text-xs opacity-60">{p.tag}</span>
              {p.text}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 flex w-full max-w-[680px] items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-text-secondary"
        >
          ← back to wallet
        </button>
        <span className="text-xs text-text-tertiary">
          agents coordinate via typed graph mutations — never free text
        </span>
      </div>
    </div>
  );
}

