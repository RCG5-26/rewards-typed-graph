import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
// Tailwind layers first, then the Malleable UI base layer so the design-system
// tokens + base rules win over Tailwind's preflight (fonts, headings, bg).
import "./globals.css";
import "../design-system/global.css";

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
