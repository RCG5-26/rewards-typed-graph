"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import BackLink from "@/components/BackLink";
import type { CardView } from "@/lib/cards/types";
import type { PublicWalletFacts } from "@/lib/comparison/types";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { isUserGraph, type UserBalance, type UserGraph } from "@/lib/user/types";
import AgentConsole from "./AgentConsole";
import CardTile from "./CardTile";
import TopBar from "./TopBar";
import WalletDataPanel from "./WalletDataPanel";
import WalletOptionsPanel from "./WalletOptionsPanel";
import WalletPointsModal from "./WalletPointsModal";

/** Stable program-id fallback when a card's program isn't in the personal graph. */
function programSlug(programName: string): string {
  return `program:${programName.toLowerCase().replace(/\s+/g, "_")}`;
}

type Step = "cards" | "ask" | "plan";

const SUGGESTED_PROMPTS = [
  { tag: "◎", text: "save a 3-night Tokyo hotel stay on points" },
  { tag: "✦", text: "redeem Chase points for the best Hyatt award" },
  { tag: "✈", text: "fly LAX → Tokyo in business this fall using my points" },
  { tag: "%", text: "most cashback on everyday spend" },
];

function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-US")}`;
}

/** Eased count-up from the previous value to `target` whenever it changes. */
function useCountUp(target: number, duration = 600): number {
  const [val, setVal] = useState(target);
  // Track the currently displayed value so a new animation starts from the
  // current frame, not the last settled target (prevents backward jumps on
  // quick toggles).
  const valueRef = useRef(target);
  const reduced = useReducedMotion();

  useEffect(() => {
    valueRef.current = val;
  }, [val]);

  useEffect(() => {
    const from = valueRef.current;
    if (from === target) return;
    if (reduced) {
      setVal(target);
      valueRef.current = target;
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const nextVal = Math.round(from + (target - from) * eased);
      valueRef.current = nextVal;
      setVal(nextVal);
      if (t < 1) raf = requestAnimationFrame(tick);
      else valueRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, reduced]);
  return val;
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
  // Canonical, seed-verified facts (transfer routes + award options) from
  // /demo/test-wallets — the "what the agents see" data shown on steps 2 & 3.
  const [facts, setFacts] = useState<PublicWalletFacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [step, setStep] = useState<Step>("cards");
  const [query, setQuery] = useState("");
  // Points the user entered per card (keyed by `card.id`) in the points modal.
  const [pointsByCard, setPointsByCard] = useState<Record<string, number>>({});
  const [showPoints, setShowPoints] = useState(false);

  // The console opens the SSE plan stream itself; here we just transition.
  function goToPlan() {
    if (!query.trim()) return;
    setStep("plan");
  }

  async function handleRestart() {
    setError(null);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      if (!res.ok) {
        setError("Could not reset the demo. Your plan was cleared locally.");
      } else {
        // Re-pull the personal graph so balances and the greeting reflect the
        // freshly reset state instead of the pre-reset values.
        const graph = await fetch("/api/me")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (graph && isUserGraph(graph)) {
          setMe(graph);
        } else {
          setMe(null);
          setError(
            "Demo was reset, but your balance could not be refreshed. You can keep going from the cards step.",
          );
        }
      }
    } catch (err) {
      console.error("demo reset failed", err);
      setError("Could not reset the demo. Your plan was cleared locally.");
    } finally {
      setSelected([]);
      setStep("cards");
      setQuery("");
      setPointsByCard({});
      setShowPoints(false);
    }
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
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      // Wallet facts (transfer routes + award options) are best-effort too: the
      // ask/plan steps just omit the "what the agents see" panel if unavailable.
      fetch("/api/demo/test-wallets")
        .then((r) => (r.ok ? (r.json() as Promise<{ wallets: PublicWalletFacts[] }>) : null))
        .catch(() => null),
    ])
      .then(([cardsData, graph, walletFacts]) => {
        if (!active) return;
        setCards(cardsData.cards);
        if (graph && isUserGraph(graph)) setMe(graph);
        if (walletFacts?.wallets?.[0]) setFacts(walletFacts.wallets[0]);
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

  const wallet = useMemo(
    () => cards.filter((c) => selected.includes(c.slug)),
    [cards, selected],
  );
  const projectedCents = useMemo(
    () => wallet.reduce((sum, c) => sum + c.firstYearValueCents, 0),
    [wallet],
  );

  // Points the user entered, summed per program (cards sharing a program add up).
  const enteredByProgram = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of wallet) {
      const pts = pointsByCard[c.id];
      if (pts === undefined) continue;
      m.set(c.programName, (m.get(c.programName) ?? 0) + pts);
    }
    return m;
  }, [wallet, pointsByCard]);

  // The "available data" shown on steps 2 & 3 — built purely from what the user
  // entered in the points modal, never the seeded demo-persona balances. Program
  // ids/currency are resolved from the personal graph (or the card) for the
  // agents, but the points are exactly what was entered. Empty until they enter.
  const enteredBalances = useMemo<UserBalance[]>(() => {
    const out: UserBalance[] = [];
    for (const [programName, points] of enteredByProgram) {
      const known = me?.balances.find((b) => b.programName === programName);
      const card = wallet.find((c) => c.programName === programName);
      out.push({
        programId: known?.programId ?? programSlug(programName),
        programName,
        currencyName: known?.currencyName ?? card?.currencyName ?? "points",
        balancePoints: points,
      });
    }
    return out;
  }, [enteredByProgram, me, wallet]);

  // Points on hand reflect only what the user actually entered in the points
  // modal — never the seeded demo-persona balances. Stays 0 (and hidden) until
  // they enter real values.
  const pointsOnHand = useMemo(() => {
    let sum = 0;
    for (const points of enteredByProgram.values()) sum += points;
    return sum;
  }, [enteredByProgram]);

  const hasEnteredPoints = enteredByProgram.size > 0;
  // Programs the user carries — scopes the facts panel to relevant routes/awards.
  const walletProgramNames = useMemo(
    () => new Set(wallet.map((c) => c.programName)),
    [wallet],
  );
  const firstName = me?.user.displayName?.split(" ")[0] ?? null;

  /**
   * Persist the per-card points entered in the modal: sum them per program,
   * resolve each program's id from the personal graph (falling back to a slug),
   * and POST to the API. Commits to local state only on a successful save so the
   * wallet rail and the step 2/3 panels reflect exactly what the server accepted.
   */
  async function handleSavePoints(pointsByCardId: Record<string, number>) {
    const byProgram = new Map<string, number>();
    for (const c of wallet) {
      const pts = pointsByCardId[c.id];
      if (pts === undefined) continue;
      byProgram.set(c.programName, (byProgram.get(c.programName) ?? 0) + pts);
    }
    const balances = Array.from(byProgram, ([programName, points]) => ({
      programId: me?.balances.find((b) => b.programName === programName)?.programId
        ?? programSlug(programName),
      points,
    }));

    const res = await fetch("/api/balances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ balances }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Could not save your points. Try again.");
    }
    setPointsByCard(pointsByCardId);
  }

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const cardWord = wallet.length === 1 ? "card" : "cards";

  const displayName = me?.user.displayName ?? null;
  const imageUrl = me?.user.imageUrl ?? null;

  return (
    <div
      data-theme="dark"
      className="relative flex h-screen w-full flex-col overflow-hidden bg-surface-subtle text-text-primary"
    >
      {/* ambient iris glow + ledger dot-grid */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 72% 18%, #14171f 0%, var(--color-bg-elevated) 38%, var(--color-bg) 78%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          WebkitMaskImage: "radial-gradient(ellipse 78% 78% at 42% 38%, black, transparent 100%)",
          maskImage: "radial-gradient(ellipse 78% 78% at 42% 38%, black, transparent 100%)",
          animation: "gp-grid-drift 60s linear infinite",
        }}
      />
      <div
        className="pointer-events-none absolute -left-40 -top-40 h-[460px] w-[460px] rounded-full"
        style={{ background: "var(--blob-glow-lg)", opacity: 0.4 }}
      />

      <TopBar step={step} displayName={displayName} imageUrl={imageUrl} />

      <div className="relative flex-1">
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
            hasEnteredPoints={hasEnteredPoints}
            onToggle={toggle}
            onOpenPoints={() => setShowPoints(true)}
            onContinue={() => setStep("ask")}
          />
        )}

        {step === "ask" && (
          <AskStep
            walletCount={wallet.length}
            cardWord={cardWord}
            query={query}
            setQuery={setQuery}
            balances={enteredBalances}
            facts={facts}
            walletProgramNames={walletProgramNames}
            onBack={() => setStep("cards")}
            onPlan={goToPlan}
            prompts={SUGGESTED_PROMPTS}
          />
        )}

        {step === "plan" && (
          <AgentConsole
            queryText={query.trim()}
            selectedCardIds={selected}
            onRestart={handleRestart}
            onEditWallet={() => setStep("cards")}
            balances={enteredBalances}
            facts={facts}
            walletProgramNames={walletProgramNames}
          />
        )}
      </div>

      {showPoints && (
        <WalletPointsModal
          cards={wallet}
          initialByCard={pointsByCard}
          onClose={() => setShowPoints(false)}
          onSubmit={handleSavePoints}
        />
      )}
    </div>
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
  hasEnteredPoints,
  onToggle,
  onOpenPoints,
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
  hasEnteredPoints: boolean;
  onToggle: (id: string) => void;
  onOpenPoints: () => void;
  onContinue: () => void;
}) {
  const hasCards = wallet.length > 0;
  const animCount = useCountUp(wallet.length, 380);
  const animValue = useCountUp(projectedCents, 650);

  return (
    <div className="absolute inset-0 z-[2] flex">
      {/* left — catalog */}
      <div className="flex min-w-0 flex-1 flex-col px-9 pb-8 pt-7">
        <div className="font-mono text-2xs font-semibold uppercase tracking-[0.18em] text-accent-text">
          {firstName ? `welcome back, ${firstName}` : "build your wallet"}
        </div>
        <h1 className="mt-2 font-display text-3xl font-light leading-[1.08] tracking-snug text-text-primary">
          Which cards
          <br />
          do you carry?
        </h1>
        <p className="mb-5 mt-2.5 max-w-[460px] text-sm leading-relaxed text-text-secondary">
          tap the cards you carry to build your wallet — the agents plan across
          everything you pick.
        </p>

        <div className="flex-1 overflow-y-auto px-2 pb-6 pt-3">
          {loading && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-[188px] animate-pulse rounded-2xl bg-white/[0.06]"
                  style={{ animationDelay: `${i * 80}ms` }}
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {cards.map((card, i) => (
                <CardTile
                  key={card.id}
                  card={card}
                  index={i}
                  selected={selected.includes(card.slug)}
                  onToggle={onToggle}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* right — wallet rail (theme grey, full height) */}
      <aside className="relative flex w-[360px] flex-none flex-col overflow-hidden border-l border-strong bg-bg-elevated px-7 py-7">
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full bg-highlight"
            style={{ boxShadow: "0 0 8px var(--color-highlight-glow)" }}
          />
          <span className="font-mono text-2xs font-semibold uppercase tracking-[0.16em] text-text-tertiary">
            your wallet
          </span>
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-display text-6xl font-semibold leading-none tracking-tighter text-text-primary tabular-nums">
            {String(animCount).padStart(2, "0")}
          </span>
          <span className="text-sm text-text-secondary">{cardWord}</span>
        </div>
        {pointsOnHand > 0 && (
          <div className="mt-2 flex items-center gap-1.5 font-mono text-2xs text-text-tertiary">
            <span className="text-text-secondary tabular-nums">{pointsOnHand.toLocaleString("en-US")}</span>
            pts on hand
          </div>
        )}

        {/* vertical wallet stack — every card's header stays visible */}
        <div className="relative my-5 flex-1 overflow-y-auto pr-1">
          {hasCards ? (
            <div className="relative mx-auto w-[280px]" style={{ height: 174 + (wallet.length - 1) * 64 }}>
              {wallet.map((w, i) => (
                <div
                  key={w.id}
                  className="absolute left-0 h-[174px] w-[280px] overflow-hidden rounded-2xl p-5 ring-1 ring-black/10"
                  style={{
                    top: `${i * 64}px`,
                    background: w.face,
                    zIndex: i,
                    boxShadow: "0 14px 32px -10px rgba(0,0,0,0.55)",
                    animation: "gp-card-in 0.45s var(--spring-snappy, ease) both",
                  }}
                >
                  <span className="absolute left-0 top-0 h-full w-1.5" style={{ background: w.accent }} />
                  <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-white/50">
                    {w.bank}
                  </div>
                  <div className="mt-1.5 truncate pr-2 text-lg font-semibold text-white/95">{w.name}</div>
                  <div className="absolute bottom-4 left-5">
                    <span
                      className="relative block h-6 w-9 overflow-hidden rounded-md"
                      style={{
                        background:
                          "linear-gradient(135deg, var(--card-chip-gold-1), var(--card-chip-gold-2))",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.45)",
                      }}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="absolute bottom-4 right-5 font-mono text-sm font-semibold" style={{ color: w.accent }}>
                    {w.rate}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-full min-h-[174px] items-center justify-center">
              <div className="flex h-[174px] w-[280px] items-center justify-center rounded-2xl border border-dashed border-strong text-center">
                <span className="max-w-[180px] text-sm text-text-tertiary">
                  your wallet is empty — pick the cards you carry
                </span>
              </div>
            </div>
          )}
        </div>

        {/* projected value */}
        <div className="relative mb-4 overflow-hidden rounded-card bg-surface p-4 shadow-sm ring-1 ring-border-subtle">
          <span className="absolute left-0 top-0 h-full w-1 bg-highlight" />
          {hasCards && (
            <span
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "linear-gradient(110deg, transparent 35%, color-mix(in srgb, var(--color-highlight-glow) 35%, transparent) 50%, transparent 65%)",
                backgroundSize: "220% 100%",
                animation: "gp-shimmer 3.6s linear infinite",
                opacity: 0.7,
              }}
            />
          )}
          <div className="relative font-mono text-2xs font-semibold uppercase tracking-[0.14em] text-text-tertiary">
            projected first-year value
          </div>
          <div className="relative mt-2 flex items-baseline gap-1.5">
            <span className="font-display text-3xl font-semibold leading-none text-text-primary tabular-nums">
              {dollars(animValue)}
            </span>
            <span className="font-mono text-2xs text-text-tertiary">/ yr · net of fees</span>
          </div>
        </div>

        {hasCards && (
          <button
            type="button"
            onClick={onOpenPoints}
            className="mb-2.5 flex items-center justify-center gap-2 rounded-full border border-strong bg-surface px-4 py-3 text-sm font-medium text-text-secondary shadow-xs transition duration-base ease-spring-snappy hover:-translate-y-0.5 hover:border-highlight-glow hover:text-text-primary"
          >
            <span className="text-accent-text">＋</span>
            {hasEnteredPoints ? "edit your points" : "add your points"}
          </button>
        )}

        <button
          type="button"
          onClick={onContinue}
          disabled={!hasCards}
          className="group relative flex items-center justify-center gap-2 rounded-full bg-highlight px-4 py-3.5 text-base font-medium text-on-highlight shadow-lg transition duration-base ease-spring-snappy hover:-translate-y-0.5 hover:bg-highlight-hover hover:shadow-float disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
          style={{
            boxShadow:
              "0 10px 34px color-mix(in srgb, var(--color-highlight-glow) 40%, transparent), 0 0 0 1px color-mix(in srgb, var(--color-highlight) 60%, transparent)",
          }}
        >
          {hasCards ? "continue" : "pick a card to continue"}
          <span className="transition-transform duration-base group-hover:translate-x-0.5">→</span>
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
  balances,
  facts,
  walletProgramNames,
  onBack,
  onPlan,
  prompts,
}: {
  walletCount: number;
  cardWord: string;
  query: string;
  setQuery: (v: string) => void;
  balances: UserBalance[];
  facts: PublicWalletFacts | null;
  walletProgramNames: Set<string>;
  onBack: () => void;
  onPlan: () => void;
  prompts: { tag: string; text: string }[];
}) {
  const ready = query.trim().length > 0;
  return (
    <div className="absolute inset-0 z-[2] flex flex-col items-center justify-center px-14 pb-10 pt-10">
      <div className="w-full max-w-[700px]" style={{ animation: "gp-step-in 0.5s var(--spring-snappy, ease) both" }}>
        <div className="font-mono text-2xs font-semibold uppercase tracking-[0.18em] text-accent-text">
          step 02 · set the goal
        </div>
        <h1 className="mt-2.5 font-display text-4xl font-light leading-[1.06] tracking-snug text-text-primary">
          What do you want
          <br />
          your points to do?
        </h1>
        <p className="mb-7 mt-3.5 max-w-[480px] text-sm leading-relaxed text-text-secondary">
          describe the trip or goal in a sentence — the agents turn it into a
          typed plan across your{" "}
          <span className="font-mono text-text-primary tabular-nums">{walletCount}</span> {cardWord}.
        </p>

        <div className="flex items-end gap-3 rounded-2xl bg-surface py-2.5 pl-4 pr-2.5 shadow-lg ring-1 ring-border transition duration-base focus-within:shadow-float focus-within:ring-2 focus-within:ring-highlight-glow">
          <span className="self-start pt-4 font-mono text-md text-accent-text">›</span>
          <label htmlFor="goal-query" className="sr-only">
            Describe what you want your points to do
          </label>
          <textarea
            id="goal-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="save a 3-night Tokyo hotel stay on points"
            rows={2}
            className="min-w-0 flex-1 resize-none bg-transparent py-3.5 text-md leading-normal text-text-primary outline-none placeholder:text-text-tertiary"
          />
          <button
            type="button"
            onClick={onPlan}
            disabled={!ready}
            className="group h-12 flex-none self-end whitespace-nowrap rounded-xl bg-highlight px-5 text-base font-medium text-on-highlight shadow-md transition duration-base ease-spring-snappy hover:-translate-y-0.5 hover:bg-highlight-hover hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
          >
            plan it <span className="inline-block transition-transform duration-base group-hover:translate-x-0.5">→</span>
          </button>
        </div>

        <div className="mt-2.5 flex items-center gap-2 pl-1">
          <span className="font-mono text-2xs uppercase tracking-wide text-text-disabled">try</span>
          <div className="flex flex-wrap gap-2">
            {prompts.map((p) => (
              <button
                key={p.text}
                type="button"
                onClick={() => setQuery(p.text)}
                className="flex items-center gap-1.5 rounded-full border border-subtle bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary shadow-xs transition duration-base ease-spring-snappy hover:-translate-y-0.5 hover:border-highlight-glow hover:text-text-primary"
              >
                <span className="text-accent-text">{p.tag}</span>
                {p.text}
              </button>
            ))}
          </div>
        </div>

        {balances.length > 0 && (
          <WalletDataPanel
            balances={balances}
            title="your points · what the agents see"
            className="mt-6"
          />
        )}
        {facts && (
          <WalletOptionsPanel
            facts={facts}
            programNames={walletProgramNames}
            className="mt-3"
          />
        )}
      </div>

      <div className="mt-9 flex w-full max-w-[700px] items-center justify-between">
        <BackLink onClick={onBack}>back to wallet</BackLink>
        <span className="font-mono text-2xs uppercase tracking-wide text-text-tertiary">
          coordination is typed graph state — never free text
        </span>
      </div>
    </div>
  );
}

