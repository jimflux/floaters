import { NextResponse } from "next/server";
import { getConnectionId } from "./auth";

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function error(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
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
