import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { type AuthEnv } from "../http/auth";
import { createBalancesRoutes } from "./routes";

const USER_ID = "user-1";
const CHASE = "00000000-0000-0000-0000-00000000b001";
const HYATT = "00000000-0000-0000-0000-00000000b002";

/** Build the app with a middleware that injects an authenticated user (or not). */
function buildApp({ authed = true }: { authed?: boolean } = {}) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    if (authed) c.set("userId", USER_ID);
    await next();
  });
  app.route("/", createBalancesRoutes());
  return app;
}

function postJson(path: string, body: unknown) {
  return new Request(`http://local${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /balances", () => {
  it("echoes the normalized per-program balances for the authenticated user", async () => {
    const app = buildApp();
    const res = await app.request(
      postJson("/balances", {
        balances: [
          { programId: CHASE, points: 120_000 },
          { programId: HYATT, points: 0 },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: USER_ID,
      balances: [
        { programId: CHASE, points: 120_000 },
        { programId: HYATT, points: 0 },
      ],
    });
  });

  it("trims programId whitespace", async () => {
    const app = buildApp();
    const res = await app.request(
      postJson("/balances", { balances: [{ programId: `  ${CHASE}  `, points: 10 }] }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { balances: { programId: string }[] };
    expect(body.balances[0]?.programId).toBe(CHASE);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const app = buildApp({ authed: false });
    const res = await app.request(postJson("/balances", { balances: [] }));
    expect(res.status).toBe(401);
  });

  it("rejects a non-array balances field", async () => {
    const app = buildApp();
    const res = await app.request(postJson("/balances", { balances: "nope" }));
    expect(res.status).toBe(400);
  });

  it("rejects a negative or non-integer points value", async () => {
    const app = buildApp();
    const negative = await app.request(
      postJson("/balances", { balances: [{ programId: CHASE, points: -5 }] }),
    );
    expect(negative.status).toBe(400);
    const fractional = await app.request(
      postJson("/balances", { balances: [{ programId: CHASE, points: 1.5 }] }),
    );
    expect(fractional.status).toBe(400);
  });

  it("rejects a duplicate programId", async () => {
    const app = buildApp();
    const res = await app.request(
      postJson("/balances", {
        balances: [
          { programId: CHASE, points: 1 },
          { programId: CHASE, points: 2 },
        ],
      }),
    );
    expect(res.status).toBe(400);
  });
});
