import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { sign, nowSeconds } from "@/lib/flux-session.js";
import { SESSION_COOKIE } from "@/lib/auth";

// End to end through a real route: the auth rules applied by requireConnection.

const state = vi.hoisted(() => ({ headers: new Headers(), upserts: 0, connected: true }));

vi.mock("next/headers", () => ({ headers: async () => state.headers }));

vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "limit", "order"]) chain[m] = () => chain;
  chain.single = async () => ({ data: state.connected ? { id: "conn-1" } : null, error: null });
  chain.upsert = async () => {
    state.upserts++;
    return { error: null };
  };
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [{ account_code: "400" }], error: null });
  return { supabase: { from: () => chain } };
});

import { GET, POST } from "./route";

const TOKEN = "test-connect-secret-0123456789abcdef"; // dummy, test only
const SECRET = "test-login-secret-0123456789abcdef01234567"; // dummy, test only
const ORIGIN = "https://floaters.flux.am";
const cookie = () => `${SESSION_COOKIE}=${sign(SECRET, { typ: "session", u: "jim", exp: nowSeconds() + 3600 })}`;

function as(h: Record<string, string>) {
  state.headers = new Headers({ host: "floaters.flux.am", "x-forwarded-proto": "https", ...h });
}

const post = () =>
  POST(
    new NextRequest(`${ORIGIN}/api/hidden-accounts`, {
      method: "POST",
      body: JSON.stringify({ accountCode: "400" }),
      headers: { "content-type": "application/json" },
    })
  );

describe("hidden-accounts auth", () => {
  const saved = { token: process.env.CONNECT_SECRET, login: process.env.FLUX_LOGIN_SECRET };
  beforeEach(() => {
    process.env.CONNECT_SECRET = TOKEN;
    process.env.FLUX_LOGIN_SECRET = SECRET;
    state.upserts = 0;
    state.connected = true;
  });
  afterEach(() => {
    process.env.CONNECT_SECRET = saved.token;
    process.env.FLUX_LOGIN_SECRET = saved.login;
  });

  it("reads with a session cookie from the web app", async () => {
    as({ cookie: cookie(), "x-floaters-client": "web" });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hiddenAccounts: ["400"] });
  });

  it("401s with no credentials", async () => {
    as({});
    expect((await GET()).status).toBe(401);
  });

  it("refuses a cookie write without the web client header", async () => {
    as({ cookie: cookie(), origin: ORIGIN });
    expect((await post()).status).toBe(403);
    expect(state.upserts).toBe(0);
  });

  it("refuses a cookie write from another flux.am origin", async () => {
    as({ cookie: cookie(), "x-floaters-client": "web", origin: "https://sonar.flux.am" });
    expect((await post()).status).toBe(403);
    expect(state.upserts).toBe(0);
  });

  it("allows a cookie write with the header from this origin", async () => {
    as({ cookie: cookie(), "x-floaters-client": "web", origin: ORIGIN });
    expect((await post()).status).toBe(200);
    expect(state.upserts).toBe(1);
  });

  it("still takes the bearer key for reads and writes", async () => {
    as({ authorization: `Bearer ${TOKEN}` });
    expect((await GET()).status).toBe(200);
    expect((await post()).status).toBe(200);
    expect(state.upserts).toBe(1);
  });

  it("says Xero isn't connected with a 503, not a 401, so the web app doesn't loop through sign-in", async () => {
    state.connected = false;
    as({ cookie: cookie(), "x-floaters-client": "web" });
    expect((await GET()).status).toBe(503);
  });

  it("compares Origin with the forwarded host and protocol", async () => {
    state.headers = new Headers({
      host: "internal:8080",
      "x-forwarded-host": "floaters.flux.am",
      "x-forwarded-proto": "https",
      cookie: cookie(),
      "x-floaters-client": "web",
      origin: ORIGIN,
    });
    expect((await post()).status).toBe(200);
  });
});
