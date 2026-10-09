import { NextResponse } from "next/server";

// Legacy no-op. To sign out of the web app, use GET /auth/logout.
export async function POST() {
  return NextResponse.json({ ok: true });
}
