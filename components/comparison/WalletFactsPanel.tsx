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
    <section className="rounded-card bg-surface p-6 shadow-sm ring-1 ring-[var(--color-border)]">
      <header className="mb-4">
        <h2 className="font-display text-lg tracking-tight text-text-primary">
          {facts.displayName}
        </h2>
        <p className="mt-1 text-sm text-text-secondary">{facts.description}</p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 font-mono text-2xs font-semibold uppercase tracking-[0.16em] text-text-tertiary">
            Program balances
          </h3>
          <ul className="space-y-1.5">
            {facts.balances.map((balance) => (
              <li
                key={balance.programId}
                className="flex items-center justify-between text-sm text-text-secondary"
              >
                <span>{balance.programName}</span>
                <span className="font-mono tabular-nums text-text-primary">
                  {formatPoints(balance.points)}
                </span>
              </li>
            ))}
          </ul>

          <h3 className="mb-2 mt-5 font-mono text-2xs font-semibold uppercase tracking-[0.16em] text-text-tertiary">
            Transfer routes
          </h3>
          <ul className="space-y-1.5">
            {facts.transferRoutes.map((route) => (
              <li
                key={`${route.sourceProgramId}-${route.destinationProgramId}`}
                className="text-sm text-text-secondary"
              >
                {programName(facts, route.sourceProgramId)} →{" "}
                {programName(facts, route.destinationProgramId)}{" "}
                <span className="text-text-tertiary">
                  ({routeRatioLabel(route.ratioBasisPoints)})
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="mb-2 font-mono text-2xs font-semibold uppercase tracking-[0.16em] text-text-tertiary">
            Cards
          </h3>
          <ul className="space-y-1.5">
            {facts.cards.map((card) => (
              <li key={card.cardId} className="text-sm text-text-secondary">
                {card.cardName} <span className="text-text-tertiary">· {card.programName}</span>
              </li>
            ))}
          </ul>

          <h3 className="mb-2 mt-5 font-mono text-2xs font-semibold uppercase tracking-[0.16em] text-text-tertiary">
            Award options
          </h3>
          <ul className="space-y-1.5">
            {facts.awardOptions.map((award) => (
              <li key={award.awardId} className="text-sm text-text-secondary">
                {award.displayName}{" "}
                <span className="font-mono text-text-tertiary">
                  {formatPoints(award.pointsRequired)} {award.programSlug.replace("program:", "")}
                </span>{" "}
                <span className="text-text-tertiary">
                  · {centsPerPoint(award.valueBasisPoints)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-6 rounded-md bg-surface-subtle p-4 ring-1 ring-[var(--color-border)]">
        <h3 className="font-mono text-2xs font-semibold uppercase tracking-[0.16em] text-text-tertiary">
          Goal
        </h3>
        <p className="mt-1 text-sm text-text-secondary">
          {facts.goal.nights}-night {facts.goal.category.replace("_", " ")} in{" "}
          {facts.goal.destination}
        </p>
        <h3 className="mt-3 font-mono text-2xs font-semibold uppercase tracking-[0.16em] text-text-tertiary">
          Query (sent verbatim to all three architectures)
        </h3>
        <p className="mt-1 font-mono text-sm text-text-primary">&ldquo;{facts.query}&rdquo;</p>
      </div>
    </section>
  );
}
