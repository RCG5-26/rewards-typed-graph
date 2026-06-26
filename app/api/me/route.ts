import "server-only";

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";

/**
 * GET /api/me — proxies to the Hono API GET /session, returning the signed-in
 * user's session record. Returns 401 when there is no session, 403 when the
 * account is not yet provisioned.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { getToken } = await auth();
    const token = await getToken();
    if (!token) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    const session = await getSession(token);
    return NextResponse.json(session);
  } catch (err) {
    if (err instanceof ApiError) {
      const status = "status" in err.kind ? err.kind.status : 500;
      if (err.kind.kind === "not-signed-in") {
        return NextResponse.json({ error: "Not signed in." }, { status });
      }
      if (err.kind.kind === "unprovisioned") {
        return NextResponse.json({ error: "Account not provisioned." }, { status });
      }
      return NextResponse.json({ error: "Could not load your account." }, { status });
    }
    console.error("GET /api/me failed", err);
    return NextResponse.json({ error: "Could not load your account." }, { status: 500 });
  }
}
