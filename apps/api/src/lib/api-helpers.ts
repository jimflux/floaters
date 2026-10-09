import { NextResponse } from "next/server";
import { resolveConnection } from "./auth";

// This is a live financial dashboard read off Supabase on every request — never
// let a browser or CDN serve a stale body. Without this, the web app's
// refetch-after-save got the cached pre-save response, so edits looked unsaved
// until a hard refresh.
const NO_STORE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
} as const;

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function error(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

export async function requireConnection(): Promise<string> {
  const result = await resolveConnection();
  if (!result.ok) {
    if (result.status === 503) throw new AuthError("Xero is not connected", 503);
    throw result.status === 403
      ? new AuthError("Forbidden", 403)
      : new AuthError("Not authenticated");
  }
  return result.connectionId;
}

export class AuthError extends Error {
  // 401: no valid credentials. 403: a valid session cookie on a request that
  // isn't from the web app (missing X-Floaters-Client or a foreign Origin).
  // 503: authenticated, but there is no Xero connection yet.
  constructor(message: string, readonly status: 401 | 403 | 503 = 401) {
    super(message);
    this.name = "AuthError";
  }
}

export function handleError(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return error(err.message, err.status);
  }
  console.error(err);
  return error("Internal server error", 500);
}
