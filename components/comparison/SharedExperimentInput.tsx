import type { PublicWalletFacts } from "@/lib/comparison/types";
import { centsPerPoint, formatPoints, programName, routeRatioLabel } from "@/lib/comparison/presentation";

/**
 * Shared experiment input — what every planner receives.
 *
 * Shows the canonical wallet snapshot (goal, question, balances, award,
 * transfer route) above the architecture comparison so it is clear that
 * all three architectures operate on identical inputs. All data comes from
 * the server-resolved canonical wallet contract — nothing is hard-coded here.
 */
export function SharedExperimentInput({ facts }: { facts: PublicWalletFacts }) {
  return (
    <section
      className="rounded-card border border-subtle bg-surface p-6"
      aria-label="Shared experiment input"
    >
      <div className="mb-5">
        <h2 className="text-base font-semibold text-text-primary">Shared experiment input</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Every planner receives the same wallet snapshot, award inventory, transfer routes, and
          planning question.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {/* Goal + question */}
        <div className="space-y-4">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
              Planning goal
            </h3>
            <p className="text-sm text-text-primary">
              {facts.goal.nights}-night {facts.goal.category.replace(/_/g, " ")} in{" "}
              {facts.goal.destination}
            </p>
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
              Canonical question
            </h3>
            <p className="font-mono text-sm leading-relaxed text-text-secondary">
              &ldquo;{facts.query}&rdquo;
            </p>
          </div>
        </div>

        {/* Balances + transfer route */}
        <div className="space-y-4">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
              Program balances
            </h3>
            <ul className="space-y-1.5">
              {facts.balances.map((balance) => (
                <li
                  key={balance.programId}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="text-text-secondary">{balance.programName}</span>
                  <span className="shrink-0 font-mono tabular-nums text-text-primary">
                    {formatPoints(balance.points)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
              Transfer route
            </h3>
            <ul className="space-y-1.5">
              {facts.transferRoutes.map((route) => (
                <li
                  key={`${route.sourceProgramId}-${route.destinationProgramId}`}
                  className="text-sm text-text-secondary"
                >
                  {programName(facts, route.sourceProgramId)} →{" "}
                  {programName(facts, route.destinationProgramId)}{" "}
                  <span className="text-text-tertiary">({routeRatioLabel(route.ratioBasisPoints)})</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Available awards */}
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
            Available award{facts.awardOptions.length !== 1 ? "s" : ""}
          </h3>
          <ul className="space-y-3">
            {facts.awardOptions.map((award) => (
              <li key={award.awardId} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-text-primary">{award.displayName}</span>
                  {award.available ? (
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-xs"
                      style={{
                        background: "color-mix(in srgb, var(--color-success) 16%, transparent)",
                        color: "var(--color-success)",
                      }}
                      aria-label="Available"
                    >
                      Available
                    </span>
                  ) : (
                    <span
                      className="shrink-0 rounded-full bg-surface-subtle px-2 py-0.5 text-xs text-text-tertiary"
                      aria-label="Unavailable"
                    >
                      Unavailable
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-text-secondary">
                  {formatPoints(award.pointsRequired)}{" "}
                  {programName(facts, award.programId)} points ·{" "}
                  {centsPerPoint(award.valueBasisPoints)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
