import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sign, nowSeconds } from "./flux-session.js";
import { authenticate, connectSecretMatches, safeNext, SESSION_COOKIE } from "./auth";

const TOKEN = "test-connect-secret-0123456789abcdef"; // dummy, test only
const SECRET = "test-login-secret-0123456789abcdef01234567"; // dummy, test only
const session = (secret = SECRET, days = 30) =>
  sign(secret, { typ: "session", u: "jim", exp: nowSeconds() + days * 86400 });

function req(h: Record<string, string>) {
  return new Headers({ host: "floaters.flux.am", "x-forwarded-proto": "https", ...h });
}

describe("authenticate", () => {
  const saved = { token: process.env.CONNECT_SECRET, login: process.env.FLUX_LOGIN_SECRET };
  beforeEach(() => {
    process.env.CONNECT_SECRET = TOKEN;
    process.env.FLUX_LOGIN_SECRET = SECRET;
  });
  afterEach(() => {
    process.env.CONNECT_SECRET = saved.token;
    process.env.FLUX_LOGIN_SECRET = saved.login;
  });

  it("lets the bearer key in", () => {
    expect(authenticate(req({ authorization: `Bearer ${TOKEN}` }))).toEqual({ ok: true, via: "token", user: null });
  });

  it("refuses a wrong or missing bearer key", () => {
    expect(authenticate(req({ authorization: "Bearer nope" }))).toEqual({ ok: false, status: 401 });
    expect(authenticate(req({}))).toEqual({ ok: false, status: 401 });
  });

  it("refuses everything by bearer when CONNECT_SECRET is unset", () => {
    delete process.env.CONNECT_SECRET;
    expect(authenticate(req({ authorization: "Bearer " }))).toEqual({ ok: false, status: 401 });
    expect(authenticate(req({ authorization: "Bearer undefined" }))).toEqual({ ok: false, status: 401 });
  });

  it("lets a web request with a valid session in", () => {
    const r = authenticate(req({ cookie: `${SESSION_COOKIE}=${session()}`, "x-floaters-client": "web" }));
    expect(r).toEqual({ ok: true, via: "session", user: "jim" });
  });

  it("accepts a same-origin Origin and refuses another flux.am subdomain", () => {
    const base = { cookie: `${SESSION_COOKIE}=${session()}`, "x-floaters-client": "web" };
    expect(authenticate(req({ ...base, origin: "https://floaters.flux.am" })).ok).toBe(true);
    expect(authenticate(req({ ...base, origin: "https://sonar.flux.am" }))).toEqual({ ok: false, status: 403 });
    expect(authenticate(req({ ...base, origin: "http://floaters.flux.am" }))).toEqual({ ok: false, status: 403 });
  });

  it("refuses a session without the web client header", () => {
    expect(authenticate(req({ cookie: `${SESSION_COOKIE}=${session()}` }))).toEqual({ ok: false, status: 403 });
  });

  it("refuses expired, wrongly signed and code-typed cookies", () => {
    for (const value of [
      session(SECRET, -1),
      session("another-secret-0123456789abcdef0123456789"),
      sign(SECRET, { typ: "code", u: "jim", aud: "floaters.flux.am", n: "x", exp: nowSeconds() + 60 }),
      "garbage",
    ]) {
      expect(authenticate(req({ cookie: `${SESSION_COOKIE}=${value}`, "x-floaters-client": "web" }))).toEqual({
        ok: false,
        status: 401,
      });
    }
  });

  it("turns cookie sign-in off without FLUX_LOGIN_SECRET, but keeps the bearer key", () => {
    delete process.env.FLUX_LOGIN_SECRET;
    expect(authenticate(req({ cookie: `${SESSION_COOKIE}=${session()}`, "x-floaters-client": "web" }))).toEqual({
      ok: false,
      status: 401,
    });
    expect(authenticate(req({ authorization: `Bearer ${TOKEN}` })).ok).toBe(true);
  });

  it("finds a good cookie among others with the same name", () => {
    const cookie = `${SESSION_COOKIE}=garbage; other=1; ${SESSION_COOKIE}=${session()}`;
    expect(authenticate(req({ cookie, "x-floaters-client": "web" })).ok).toBe(true);
  });
});

describe("connectSecretMatches", () => {
  it("compares whole values only", () => {
    const saved = process.env.CONNECT_SECRET;
    process.env.CONNECT_SECRET = TOKEN;
    expect(connectSecretMatches(TOKEN)).toBe(true);
    expect(connectSecretMatches(TOKEN.slice(0, -1))).toBe(false);
    expect(connectSecretMatches(`${TOKEN}x`)).toBe(false);
    expect(connectSecretMatches(null)).toBe(false);
    process.env.CONNECT_SECRET = saved;
  });
});

describe("safeNext", () => {
  it("keeps local paths", () => {
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/?view=projected")).toBe("/?view=projected");
  });

  it("refuses anything that could leave the site", () => {
    for (const next of [null, "", "https://evil.com/", "//evil.com/", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "javascript:alert(1)", "evil.com"]) {
      expect(safeNext(next)).toBe("/");
    }
  });
});
