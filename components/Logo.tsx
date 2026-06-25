import Link from "next/link";

/**
 * GPFree wordmark — the single global logo. "GPFREE" in the display face with a
 * glowing accent dot. Token-driven so it adapts to any surface: pass
 * `tone="light"` on dark backgrounds. Wrap in a link with `href` (defaults to
 * home) to make it navigable.
 */
export default function Logo({
  href,
  tone = "default",
  className = "",
}: {
  href?: string;
  tone?: "default" | "light";
  className?: string;
}) {
  const color = tone === "light" ? "text-white" : "text-text-primary";

  const mark = (
    <span className={`group inline-flex items-center gap-2 ${color} ${className}`}>
      <span className="font-display text-md font-semibold uppercase leading-none tracking-[0.2em] transition-colors group-hover:text-accent-fg">
        GPFree
      </span>
      <span
        className="h-1.5 w-1.5 rounded-full bg-accent transition-transform duration-base ease-spring-snappy group-hover:scale-125"
        style={{ boxShadow: "0 0 10px var(--color-accent)" }}
      />
    </span>
  );

  if (href === undefined) return mark;
  return (
    <Link href={href} aria-label="GPFree home" className="inline-flex w-fit">
      {mark}
    </Link>
  );
}
