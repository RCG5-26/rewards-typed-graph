import { AuthenticateWithRedirectCallback } from "@clerk/nextjs";

/**
 * OAuth landing route. Clerk redirects back here after Google authenticates the
 * user; this component finishes the handshake and forwards to the destination
 * configured in `redirectUrlComplete` (the app home).
 */
export default function SSOCallbackPage() {
  return <AuthenticateWithRedirectCallback />;
}
