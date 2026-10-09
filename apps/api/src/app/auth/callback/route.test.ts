import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { sign, nowSeconds } from "@/lib/flux-session.js";
import { authenticate, SESSION_COOKIE } from "@/lib/auth";
import { GET } from "./route";
import { GET as logout } from "../logout/route";

const SECRET = "test-login-secret-0123456789abcdef01234567"; // dummy, test only
const HOST = "floaters.flux.am";
let counter = 0;
const code = (over: Record<string, unknown> = {}) =>
  sign(SECRET, { typ: "code", u: "jim", aud: HOST, n: `n-${Date.now()}-${counter++}`, exp: nowSeconds() + 60, ...over });

function callback(c: string, next = "/", host = HOST) {
  const url = `https://${host}/auth/callback?code=${encodeURIComponent(c)}&next=${encodeURIComponent(next)}`;
  return GET(new NextRequest(url, { headers: { "x-forwarded-host": host, "x-forwarded-proto": "https" } }));
}

describe("/auth/callback", () => {
  const saved = process.env.FLUX_LOGIN_SECRET;
  beforeEach(() => {
    process.env.FLUX_LOGIN_SECRET = SECRET;
  });
  afterEach(() => {
    process.env.FLUX_LOGIN_SECRET = saved;
  });

  it("turns a good code into a host-only session and redirects to the local path", async () => {
    const res = await callback(code(), "/?view=projected");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/?view=projected");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-floaters_session=/);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\/(;|$)/);
    expect(cookie).toMatch(/Max-Age=2592000/);

    const value = decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("="));
    const auth = authenticate(
      new Headers({ host: HOST, "x-forwarded-proto": "https", cookie: `${SESSION_COOKIE}=${value}`, "x-floaters-client": "web" })
    );
    expect(auth).toEqual({ ok: true, via: "session", user: "jim" });
  });

  it("accepts a code once only", async () => {
    const c = code();
    expect((await callback(c)).status).toBe(303);
    const again = await callback(c);
    expect(again.status).toBe(400);
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("refuses expired, wrong-audience, wrong-type, wrong-secret and junk codes", async () => {
    for (const bad of [
      code({ exp: nowSeconds() - 1 }),
      code({ aud: "burn.flux.am" }),
      code({ typ: "session" }),
      code({ n: 42 }),
      sign("another-secret-0123456789abcdef0123456789", { typ: "code", u: "jim", aud: HOST, n: "x", exp: nowSeconds() + 60 }),
      "garbage",
      "",
    ]) {
      const res = await callback(bad);
      expect(res.status).toBe(400);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
  });

  it("checks aud against the host the browser used", async () => {
    expect((await callback(code(), "/", "floaters.up.railway.app")).status).toBe(400);
  });

  it("only redirects to a path on this site", async () => {
    for (const next of ["https://evil.com/", "//evil.com/", "/\\evil.com", "/\t/evil.com", "javascript:alert(1)"]) {
      const res = await callback(code(), next);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/");
    }
  });

  it("refuses every code when FLUX_LOGIN_SECRET is unset", async () => {
    const c = code();
    delete process.env.FLUX_LOGIN_SECRET;
    expect((await callback(c)).status).toBe(400);
  });
});

describe("/auth/logout", () => {
  it("clears the session cookie and goes to login.flux.am/logout", async () => {
    const res = await logout();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://login.flux.am/logout");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^__Host-floaters_session=;/);
    expect(cookie).toMatch(/Max-Age=0/);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\/(;|$)/);
  });
});
