import { NextResponse } from "next/server";

// No session to clear — API key auth is stateless.
export async function POST() {
  return NextResponse.json({ ok: true });
}
