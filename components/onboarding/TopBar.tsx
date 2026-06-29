"use client";

import { useEffect, useRef, useState } from "react";
import { useClerk } from "@clerk/nextjs";

import Logo from "@/components/Logo";

type Step = "cards" | "ask" | "plan";

const STEPS: { id: Step; n: string; label: string }[] = [
  { id: "cards", n: "01", label: "wallet" },
  { id: "ask", n: "02", label: "ask" },
  { id: "plan", n: "03", label: "plan" },
];

/**
 * Onboarding chrome: the GPFree wordmark, a typed step rail, and an account
 * menu (Home / Sign out). The mark + rail read as an instrument header; the
 * menu hangs off an initials chip. Sign-out routes through Clerk back to the
 * public landing.
 */
export default function TopBar({
  step,
  displayName,
  imageUrl,
}: {
  step: Step;
  displayName: string | null;
  imageUrl?: string | null;
}) {
  const { signOut } = useClerk();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const initials =
    (displayName ?? "")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "·";

  const activeIdx = STEPS.findIndex((s) => s.id === step);

  return (
    <header className="relative z-20 flex flex-none items-center justify-between border-b border-subtle bg-[var(--glass-light)] px-7 py-3.5 backdrop-blur-md">
      {/* global wordmark — click to go home */}
      <Logo href="/" tone="light" />

      {/* typed step rail — numbered nodes with a filled accent active/done node */}
      <nav
        className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-2.5 md:flex"
        aria-label="Onboarding progress"
      >
        {STEPS.map((s, i) => {
          const active = i === activeIdx;
          const done = i < activeIdx;
          const filled = active || done;
          return (
            <div key={s.id} className="flex items-center gap-2.5">
              <div className="flex items-center gap-2">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full font-mono text-2xs font-semibold tabular-nums transition-all duration-base"
                  style={{
                    background: active
                      ? "var(--color-highlight)"
                      : done
                        ? "color-mix(in srgb, var(--color-highlight-glow) 25%, transparent)"
                        : "var(--color-surface-raised)",
                    color: active
                      ? "var(--color-on-highlight)"
                      : done
                        ? "var(--color-highlight-glow)"
                        : "var(--color-text-disabled)",
                    border: active ? "none" : "1px solid var(--color-border-strong)",
                    boxShadow: active
                      ? "0 0 0 4px color-mix(in srgb, var(--color-highlight-glow) 30%, transparent)"
                      : "none",
                  }}
                >
                  {s.n}
                </span>
                <span
                  className="text-xs font-medium lowercase tracking-wide transition-colors"
                  style={{
                    color: active ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                  }}
                >
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <span
                  className="h-px w-7"
                  style={{
                    background:
                      filled && done ? "var(--color-highlight-glow)" : "var(--color-border-strong)",
                  }}
                />
              )}
            </div>
          );
        })}
      </nav>

      {/* account menu */}
      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-full border border-subtle bg-surface py-1 pl-1 pr-2.5 shadow-xs transition hover:shadow-sm"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Account menu for ${displayName ?? "your account"}`}
        >
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 font-mono text-2xs font-semibold text-white">
              {initials}
            </span>
          )}
          <span className="hidden text-xs font-medium text-text-secondary sm:inline">
            {displayName?.split(" ")[0] ?? "account"}
          </span>
          <svg
            width="11"
            height="11"
            viewBox="0 0 12 12"
            className={`transition-transform duration-base ${open ? "rotate-180" : ""}`}
            aria-hidden="true"
          >
            <path
              d="M2.5 4.5 6 8l3.5-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-text-tertiary"
            />
          </svg>
        </button>

        {open && (
          <div
            role="menu"
            className="absolute right-0 top-[calc(100%+8px)] w-48 overflow-hidden rounded-xl border border-subtle bg-surface shadow-float"
            style={{ animation: "gp-menu-in 0.18s var(--spring-snappy, ease) both" }}
          >
            <div className="border-b border-subtle px-3.5 py-2.5">
              <div className="font-mono text-2xs uppercase tracking-wide text-text-tertiary">
                signed in
              </div>
              <div className="truncate text-sm font-medium text-text-primary">
                {displayName ?? "Demo persona"}
              </div>
            </div>
            <MenuItem
              label="Sign out"
              danger
              onClick={() => {
                setOpen(false);
                void signOut({ redirectUrl: "/" });
              }}
              icon={
                <path
                  d="M6 13H3V3h3M10 10.5 13 8l-3-2.5M13 8H6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              }
            />
          </div>
        )}
      </div>
    </header>
  );
}

function MenuItem({
  label,
  icon,
  onClick,
  danger,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm font-medium transition-colors hover:bg-surface-subtle"
      style={{ color: danger ? "var(--color-error)" : "var(--color-text-primary)" }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        {icon}
      </svg>
      {label}
    </button>
  );
}
