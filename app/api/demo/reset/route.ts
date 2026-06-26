import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { demoReset } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";

/**
 * POST /api/demo/reset — proxies to the Hono API POST /demo/reset, resetting
 * the demo user's account to its seeded state. Returns 401 when not signed in.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const { getToken } = await auth();
    const token = await getToken();
    if (!token) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    const result = await demoReset(token);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      const status = "status" in err.kind ? err.kind.status : 500;
      if (err.kind.kind === "not-signed-in") {
        return NextResponse.json({ error: "Not signed in." }, { status });
      }
      if (err.kind.kind === "unprovisioned") {
        return NextResponse.json({ error: "Account not provisioned." }, { status });
      }
      return NextResponse.json({ error: "Could not reset demo." }, { status });
    }
    console.error("POST /api/demo/reset failed", err);
    return NextResponse.json({ error: "Could not reset demo." }, { status: 500 });
  }
}
