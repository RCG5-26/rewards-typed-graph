import OnboardingFlow from "@/components/onboarding/OnboardingFlow";

// Protected by middleware.ts (only `/`, `/sign-in`, `/sign-up`, `/sso-callback`
// are public) — a signed-in session is guaranteed before this renders.
export const metadata = {
  title: "Build your wallet — GPFree",
};

export default function OnboardingPage() {
  return <OnboardingFlow />;
}
