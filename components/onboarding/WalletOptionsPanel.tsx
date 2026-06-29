import {
  centsPerPoint,
  formatPoints,
  programName,
  routeRatioLabel,
} from "@/lib/comparison/presentation";
import type { PublicWalletFacts } from "@/lib/comparison/types";

/**
 * The transfer routes + award options the agents can use — the same real,
 * seed-verified facts the /test-wallets page surfaces (`GET /demo/test-wallets`),
 * rendered in the onboarding light theme. Pairs with `WalletDataPanel` (entered
 * balances) on steps 2 & 3 to show the full "what the agents see" picture.
 *
 * Optionally filtered to the programs the user actually carries (their selected
 * cards' programs) so the panel stays relevant to the wallet they built.
 */
export default function WalletOptionsPanel({
  facts,
  programNames,
  className = "",
}: {
  facts: PublicWalletFacts;
  /** When provided, only routes/awards touching these program names are shown. */
  programNames?: Set<string>;
  className?: string;
}) {
  const idOf = (name: string) =>
    facts.programs.find((p) => p.name === name)?.programId;
  const relevantIds =
    programNames && programNames.size > 0
      ? new Set(
          Array.from(programNames)
            .map(idOf)
            .filter((id): id is string => Boolean(id)),
        )
      : null;

  const routes = relevantIds
    ? facts.transferRoutes.filter(
        (r) => relevantIds.has(r.sourceProgramId) || relevantIds.has(r.destinationProgramId),
      )
    : facts.transferRoutes;
  const awards = relevantIds
    ? facts.awardOptions.filter((a) => relevantIds.has(a.programId))
    : facts.awardOptions;

  if (routes.length === 0 && awards.length === 0) return null;

  return (
    <section
      className={`overflow-hidden rounded-card bg-surface p-4 shadow-sm ring-1 ring-border ${className}`}
    >
      <header className="mb-2.5 flex items-center justify-between">
        <span className="font-mono text-2xs font-semibold uppercase tracking-[0.16em] text-text-tertiary">
          transfer routes &amp; awards · what the agents see
        </span>
        <span className="font-mono text-2xs text-text-tertiary">live facts</span>
      </header>

      {routes.length > 0 && (
        <>
          <div className="mb-1.5 font-mono text-2xs uppercase tracking-wide text-text-disabled">
            transfer routes
          </div>
          <ul className="mb-3 space-y-1.5">
            {routes.map((route) => (
              <li
                key={`${route.sourceProgramId}-${route.destinationProgramId}`}
                className="flex items-center justify-between text-sm text-text-secondary"
              >
                <span className="truncate">
                  {programName(facts, route.sourceProgramId)}{" "}
                  <span className="text-text-tertiary">→</span>{" "}
                  {programName(facts, route.destinationProgramId)}
                </span>
                <span className="flex-none pl-3 font-mono text-2xs tabular-nums text-text-primary">
                  {routeRatioLabel(route.ratioBasisPoints)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {awards.length > 0 && (
        <>
          <div className="mb-1.5 font-mono text-2xs uppercase tracking-wide text-text-disabled">
            award options
          </div>
          <ul className="space-y-1.5">
            {awards.map((award) => (
              <li
                key={award.awardId}
                className="flex items-center justify-between gap-3 text-sm text-text-secondary"
              >
                <span className="min-w-0 truncate">{award.displayName}</span>
                <span className="flex-none font-mono text-2xs tabular-nums text-text-primary">
                  {formatPoints(award.pointsRequired)}{" "}
                  <span className="text-text-tertiary">
                    · {centsPerPoint(award.valueBasisPoints)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
