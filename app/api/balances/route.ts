import "server-only";

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { submitBalances } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import type { ApiBalanceInput } from "@/lib/api/types";

/**
 * POST /api/balances — proxy to the authenticated Hono `POST /balances`.
 *
 * The wallet picker submits how many points the user holds per program; this
 * route injects the Clerk Bearer token server-side (BFF architecture — the
 * browser never calls Hono directly) and forwards the normalized balances.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { getToken, userId } = await auth();
    const token = await getToken();
    if (!token || !userId) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as { balances?: unknown };
    if (!Array.isArray(body.balances)) {
      return NextResponse.json({ error: "balances must be an array." }, { status: 400 });
    }

    // Trust the Hono route for full validation; here we only narrow the shape so
    // a malformed entry doesn't reach the API as garbage.
    const balances: ApiBalanceInput[] = [];
    for (const entry of body.balances) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof (entry as ApiBalanceInput).programId !== "string" ||
        typeof (entry as ApiBalanceInput).points !== "number"
      ) {
        return NextResponse.json(
          { error: "Each balance needs a programId and a numeric points value." },
          { status: 400 },
        );
      }
      balances.push({
        programId: (entry as ApiBalanceInput).programId,
        points: (entry as ApiBalanceInput).points,
      });
    }

    const response = await submitBalances(balances, token);
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof ApiError) {
      const status = "status" in err.kind ? err.kind.status : 500;
      if (err.kind.kind === "not-signed-in") {
        return NextResponse.json({ error: "Not signed in." }, { status });
      }
      if (err.kind.kind === "unprovisioned") {
        return NextResponse.json(
          { error: "No account is provisioned for this sign-in." },
          { status },
        );
      }
      if (err.kind.kind === "misconfigured") {
        // e.g. API_BASE_URL unset — surface the real reason, not a generic save error.
        return NextResponse.json({ error: err.kind.message }, { status: 500 });
      }
      // server-error: the upstream Hono API answered (or timed out / was
      // unreachable). Forward its message so the modal shows the true cause
      // (e.g. "Hono API request failed" when nothing is listening on :8787).
      return NextResponse.json(
        { error: err.kind.message || `API responded ${err.kind.status}.` },
        { status: err.kind.status },
      );
    }
    console.error("POST /api/balances failed", err);
    return NextResponse.json(
      { error: "Could not reach the API to save your points." },
      { status: 502 },
    );
  }
}
