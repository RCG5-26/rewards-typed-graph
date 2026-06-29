import type { UserBalance } from "@/lib/user/types";

/**
 * The "what the agents see" panel for the onboarding ask/plan steps — the same
 * available data the Test Wallets page surfaces (program balances), but sourced
 * from the signed-in user's own `/api/me` graph and merged with the points they
 * entered in the wallet picker. Light-theme sibling of the comparison page's
 * `WalletFactsPanel`, styled to the onboarding design system.
 */
export default function WalletDataPanel({
  balances,
  title = "your points",
  className = "",
}: {
  balances: UserBalance[];
  title?: string;
  className?: string;
}) {
  if (balances.length === 0) return null;

  const total = balances.reduce((sum, b) => sum + b.balancePoints, 0);

  return (
    <section
      className={`overflow-hidden rounded-card bg-surface p-4 shadow-sm ring-1 ring-border ${className}`}
    >
      <header className="mb-2.5 flex items-center justify-between">
        <span className="font-mono text-2xs font-semibold uppercase tracking-[0.16em] text-text-tertiary">
          {title}
        </span>
        <span className="font-mono text-2xs text-text-tertiary">
          <span className="text-text-secondary tabular-nums">
            {total.toLocaleString("en-US")}
          </span>{" "}
          pts total
        </span>
      </header>
      <ul className="space-y-1.5">
        {balances.map((b) => (
          <li
            key={b.programId}
            className="flex items-center justify-between border-b border-subtle pb-1.5 text-sm last:border-0 last:pb-0"
          >
            <span className="truncate text-text-secondary">{b.programName}</span>
            <span className="flex-none pl-3 font-mono tabular-nums text-text-primary">
              {b.balancePoints.toLocaleString("en-US")}{" "}
              <span className="text-text-tertiary">{b.currencyName}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
