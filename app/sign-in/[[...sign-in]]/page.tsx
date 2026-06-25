import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import GoogleAuthCard from "@/components/auth/GoogleAuthCard";

// Already signed in? Skip the sign-in card entirely and go straight to the
// pick-cards flow — server-side, so there's no blank flash on /sign-in.
export default async function SignInPage() {
  const { userId } = await auth();
  if (userId) redirect("/onboarding");

  return (
    <GoogleAuthCard
      heading="Sign in to GPFree"
      subheading="Use your Google account to access your rewards graph."
    />
  );
}
