"use client";

import { useEffect, useState } from "react";
import { useAuth, useSignIn } from "@clerk/nextjs";
import { useRouter } from "next/navigation";

import Logo from "@/components/Logo";

/** Where a signed-in user lands: the onboarding pick-cards flow. */
const AFTER_SIGN_IN = "/onboarding";

/**
 * Google-only authentication card.
 *
 * Per ADR-0006 (Clerk identity-only), the demo offers a single sign-in path:
 * "Continue with Google". We drive the OAuth flow manually via `useSignIn`
 * rather than rendering Clerk's `<SignIn>` widget, so the UI only ever exposes
 * Google — independent of which connections are toggled in the Clerk dashboard.
 *
 * Google OAuth covers both sign-in and sign-up (Clerk auto-provisions the user
 * on first login), so this one component backs both routes.
 */
export default function GoogleAuthCard({
  heading,
  subheading,
}: {
  heading: string;
  subheading: string;
}) {
  const { signIn, isLoaded } = useSignIn();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Already signed in (e.g. landed on /sign-in with an active session)?
  // Skip the OAuth start — Clerk would throw `session_exists` — and go
  // straight to the pick-cards flow.
  useEffect(() => {
    if (isSignedIn) router.replace(AFTER_SIGN_IN);
  }, [isSignedIn, router]);

  async function continueWithGoogle() {
    if (!isLoaded || !signIn) return;
    if (isSignedIn) {
      router.replace(AFTER_SIGN_IN);
      return;
    }
    setError(null);
    setPending(true);
    try {
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: "/sso-callback",
        // Land in the onboarding flow (pick cards) after a successful sign-in.
        redirectUrlComplete: "/onboarding",
      });
    } catch (err) {
      console.error("Google sign-in failed", err);
      // Surface Clerk's real reason (e.g. "oauth_google is not enabled") instead
      // of a generic string, so config issues are diagnosable from the UI.
      const clerkMessage =
        err &&
        typeof err === "object" &&
        "errors" in err &&
        Array.isArray((err as { errors?: { code?: string; longMessage?: string; message?: string }[] }).errors)
          ? (err as { errors: { code?: string; longMessage?: string; message?: string }[] }).errors[0]
          : null;
      // An active session already exists — just proceed into the app.
      if (clerkMessage?.code === "session_exists" || isSignedIn) {
        router.replace(AFTER_SIGN_IN);
        return;
      }
      setError(
        clerkMessage?.longMessage ||
          clerkMessage?.message ||
          (err instanceof Error ? err.message : null) ||
          "Could not start Google sign-in. Please try again.",
      );
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo href="/" />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{heading}</h1>
        <p className="text-sm text-gray-500">{subheading}</p>
      </div>

      <button
        type="button"
        onClick={continueWithGoogle}
        disabled={!isLoaded || pending}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <GoogleGlyph />
        {pending ? "Redirecting…" : "Continue with Google"}
      </button>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
