import type { PublicWalletFacts } from "@/lib/comparison/types";
import {
  centsPerPoint,
  formatPoints,
  programName,
  routeRatioLabel,
} from "@/lib/comparison/presentation";

/**
 * The "what the agents see" panel shown before any run: cards, balances,
 * transfer routes, award options, the scenario purpose, and the exact query.
 * These come from the server-resolved canonical facts — never hard-coded here.
 */
export function WalletFactsPanel({ facts }: { facts: PublicWalletFacts }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-white">{facts.displayName}</h2>
        <p className="mt-1 text-sm text-white/60">{facts.description}</p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">
            Program balances
          </h3>
          <ul className="space-y-1.5">
            {facts.balances.map((balance) => (
              <li
                key={balance.programId}
                className="flex items-center justify-between text-sm text-white/80"
              >
                <span>{balance.programName}</span>
                <span className="font-mono tabular-nums text-white">
                  {formatPoints(balance.points)}
                </span>
              </li>
            ))}
          </ul>

          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-white/40">
            Transfer routes
          </h3>
          <ul className="space-y-1.5">
            {facts.transferRoutes.map((route) => (
              <li
                key={`${route.sourceProgramId}-${route.destinationProgramId}`}
                className="text-sm text-white/80"
              >
                {programName(facts, route.sourceProgramId)} →{" "}
                {programName(facts, route.destinationProgramId)}{" "}
                <span className="text-white/50">({routeRatioLabel(route.ratioBasisPoints)})</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">
            Cards
          </h3>
          <ul className="space-y-1.5">
            {facts.cards.map((card) => (
              <li key={card.cardId} className="text-sm text-white/80">
                {card.cardName}{" "}
                <span className="text-white/50">· {card.programName}</span>
              </li>
            ))}
          </ul>

          <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-white/40">
            Award options
          </h3>
          <ul className="space-y-1.5">
            {facts.awardOptions.map((award) => (
              <li key={award.awardId} className="text-sm text-white/80">
                {award.displayName}{" "}
                <span className="font-mono text-white/60">
                  {formatPoints(award.pointsRequired)} {award.programSlug.replace("program:", "")}
                </span>{" "}
                <span className="text-white/40">· {centsPerPoint(award.valueBasisPoints)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-white/10 bg-black/30 p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40">
          Goal
        </h3>
        <p className="mt-1 text-sm text-white/80">
          {facts.goal.nights}-night {facts.goal.category.replace("_", " ")} in{" "}
          {facts.goal.destination}
        </p>
        <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-white/40">
          Query (sent verbatim to all three architectures)
        </h3>
        <p className="mt-1 font-mono text-sm text-white/90">&ldquo;{facts.query}&rdquo;</p>
      </div>
    </section>
  );
}
