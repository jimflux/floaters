import { NextResponse } from "next/server";
import { LOGIN_URL, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

// A plain link from the page. Clears this tool's session, then signs out of
// login.flux.am too. Worst case another site signs Jim out.

export const dynamic = "force-dynamic";

export async function GET() {
  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: `${LOGIN_URL}logout`, "Cache-Control": "no-store" },
  });
  // A __Host- cookie is only cleared by a Set-Cookie with the same Secure and Path.
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions, maxAge: 0, expires: new Date(0) });
  return response;
}
