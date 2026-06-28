import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
// Tailwind layers first, then the Malleable UI base layer so the design-system
// tokens + base rules win over Tailwind's preflight (fonts, headings, bg).
import "./globals.css";
import "../design-system/global.css";

// Every route sits under <ClerkProvider>, which needs request-time auth
// context. Force dynamic rendering so the production build does not attempt to
// statically prerender Clerk-dependent pages (which fails with a null React
// dispatcher at build time).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "GPFree — Your points are worth more than you think",
  description:
    "GPFree optimizes your credit-card travel rewards. Add the cards you carry, name the trip, and let the agents search every program to book the sweet spot.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
