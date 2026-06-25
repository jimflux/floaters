import { NextResponse } from "next/server";
import { getConnectionId } from "./auth";

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
  const connectionId = await getConnectionId();
  if (!connectionId) {
    throw new AuthError("Not authenticated");
  }
  return connectionId;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function handleError(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return error("Not authenticated", 401);
  }
  console.error(err);
  return error("Internal server error", 500);
}
