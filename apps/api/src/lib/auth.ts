import { createHash, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { supabase } from "./supabase";
import { cookieClaims } from "./flux-session.js";

/**
 * Single-user auth. A request gets in with either:
 * - `Authorization: Bearer <CONNECT_SECRET>` (the MCP server, scripts, and the
 *   remote /mcp/<secret> endpoint's loopback calls), or
 * - a login.flux.am session cookie (the web app), set by /auth/callback.
 *
 * The cookie is sent with requests from every flux.am subdomain, and some of
 * those are hosted by third parties, so SameSite=Lax is not enough on its own.
 * A cookie-authenticated request must also carry `X-Floaters-Client: web`
 * (which a form or another site can't add without a CORS preflight, and there
 * is no CORS) and, when it has an Origin, that Origin must be this site. The
 * header is required on reads too: the web app always sends it, and it keeps
 * the whole rule in one place that doesn't depend on the method.
 */

// Host-only, so no other flux.am subdomain can read, set or overwrite it.
export const SESSION_COOKIE = "__Host-floaters_session";
export const SESSION_DAYS = 30;
export const CLIENT_HEADER = "x-floaters-client";
export const LOGIN_URL = "https://login.flux.am/";

export const sessionCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};

/** FLUX_LOGIN_SECRET, shared only with login.flux.am. Unset (or too short) turns cookie sign-in off. */
export function loginSecret(): string | undefined {
  const secret = process.env.FLUX_LOGIN_SECRET;
  return secret && secret.length >= 32 ? secret : undefined;
}

// Hash both sides so the comparison is constant time whatever the length.
const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time check against CONNECT_SECRET. False when it isn't set. */
export function connectSecretMatches(candidate: string | null | undefined): boolean {
  const expected = process.env.CONNECT_SECRET;
  if (!expected || !candidate) return false;
  return timingSafeEqual(digest(candidate), digest(expected));
}

const first = (value: string | null) => value?.split(",")[0].trim() || null;

/** This request's host (with any port) as the browser addressed it. Railway's proxy sets X-Forwarded-Host. */
export function requestHost(h: Headers, fallback?: string): string | null {
  return first(h.get("x-forwarded-host")) ?? first(h.get("host")) ?? fallback ?? null;
}

/** The host without a port, for comparing with a sign-in code's `aud`. */
export function requestHostname(h: Headers, fallback?: string): string | null {
  return requestHost(h, fallback)?.replace(/:\d+$/, "") ?? null;
}

function requestOrigin(h: Headers): string | null {
  const host = requestHost(h);
  if (!host) return null;
  return `${first(h.get("x-forwarded-proto")) ?? "http"}://${host}`;
}

export type AuthResult =
  | { ok: true; via: "token" | "session"; user: string | null }
  | { ok: false; status: 401 | 403 };

/** Decides whether a request is let in, from its headers alone. */
export function authenticate(h: Headers): AuthResult {
  const match = /^Bearer\s+(.+)$/i.exec(h.get("authorization") ?? "");
  if (match && connectSecretMatches(match[1].trim())) {
    return { ok: true, via: "token", user: null };
  }

  const secret = loginSecret();
  const session = secret
    ? cookieClaims({ headers: { cookie: h.get("cookie") ?? "" } }, SESSION_COOKIE, secret, "session")
    : null;
  if (!session) return { ok: false, status: 401 };

  const origin = h.get("origin");
  const sameOrigin = !origin || origin === requestOrigin(h);
  if (h.get(CLIENT_HEADER) !== "web" || !sameOrigin) return { ok: false, status: 403 };

  return { ok: true, via: "session", user: typeof session.u === "string" ? session.u : null };
}

// 503: signed in, but Xero isn't connected yet (run /auth/connect). Not a 401,
// or the web app would bounce between here and login.flux.am.
export type ConnectionResult =
  | { ok: true; connectionId: string }
  | { ok: false; status: 401 | 403 | 503 };

/** Authenticates the current request and returns the one connection's id. */
export async function resolveConnection(): Promise<ConnectionResult> {
  const auth = authenticate(await headers());
  if (!auth.ok) return auth;

  const { data } = await supabase
    .from("xero_connections")
    .select("id")
    .limit(1)
    .single();

  return data?.id ? { ok: true, connectionId: data.id } : { ok: false, status: 503 };
}

export async function getConnectionId(): Promise<string | null> {
  const result = await resolveConnection();
  return result.ok ? result.connectionId : null;
}

// Sign-in codes are single use. Memory is enough because the service runs as a
// single Railway replica and codes live 60 seconds. With more replicas, a code
// could be replayed on another one: move this to the database first.
const usedCodes = new Map<string, number>();

/** Records a code's `n`. False if it has been used before. */
export function claimCode(n: string, exp: number): boolean {
  const now = Math.floor(Date.now() / 1000);
  for (const [seen, seenExp] of usedCodes) if (seenExp < now) usedCodes.delete(seen);
  if (usedCodes.has(n)) return false;
  usedCodes.set(n, exp);
  return true;
}

/**
 * Only a path on this site, never another host. Control characters are refused
 * because browsers drop tabs and newlines from URLs, so `/\t/evil.com` would
 * become `//evil.com`.
 */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\x00-\x1f\x7f]/.test(next)) return "/";
  return next;
}
