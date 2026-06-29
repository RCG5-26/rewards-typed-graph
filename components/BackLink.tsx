import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The single "go back" control for the whole app. Every back affordance — a
 * previous onboarding step or a cross-page return — uses this so the gesture
 * reads identically everywhere: a bordered pill with a leading arrow that
 * nudges left on hover and an icy-highlight focus/hover edge.
 *
 * Pass `href` for page navigation (renders a Next.js Link) or `onClick` for
 * in-flow step changes (renders a button). Exactly one is expected.
 */
export default function BackLink({
  href,
  onClick,
  children,
  className = "",
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}) {
  const classes =
    "group inline-flex items-center gap-2 rounded-full border border-strong bg-surface px-4 py-2 " +
    "text-xs font-semibold text-text-secondary shadow-xs transition duration-base ease-spring-snappy " +
    "hover:-translate-y-0.5 hover:border-highlight-glow hover:text-text-primary " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-glow " +
    className;

  const inner = (
    <>
      <span
        className="transition-transform duration-base group-hover:-translate-x-0.5"
        aria-hidden="true"
      >
        ←
      </span>
      {children}
    </>
  );

  if (href !== undefined) {
    return (
      <Link href={href} className={classes}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={classes}>
      {inner}
    </button>
  );
}
