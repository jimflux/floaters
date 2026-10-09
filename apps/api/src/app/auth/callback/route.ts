import { NextRequest, NextResponse } from "next/server";
import { nowSeconds, sign, verify } from "@/lib/flux-session.js";
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  claimCode,
  loginSecret,
  requestHostname,
  safeNext,
  sessionCookieOptions,
} from "@/lib/auth";

// Sign-in hand-over from login.flux.am. It sends Jim here with a code signed
// with this tool's own secret (FLUX_LOGIN_SECRET), meant for this host, single
// use and valid for 60 seconds. A good code becomes a 30-day session cookie.
// (Xero needs no callback: it connects as a Custom Connection via /auth/connect.)

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const secret = loginSecret();
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const claims = secret ? verify(secret, code, "code") : null;
  if (
    !claims ||
    claims.aud !== requestHostname(request.headers, request.nextUrl.host) ||
    typeof claims.n !== "string" ||
    !claimCode(claims.n, claims.exp)
  ) {
    return new NextResponse("That sign-in link has expired. Go back and try again.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const response = new NextResponse(null, {
    status: 303,
    headers: { Location: safeNext(request.nextUrl.searchParams.get("next")), "Cache-Control": "no-store" },
  });
  response.cookies.set(
    SESSION_COOKIE,
    sign(secret, { typ: "session", u: claims.u, exp: nowSeconds() + SESSION_DAYS * 86400 }),
    { ...sessionCookieOptions, maxAge: SESSION_DAYS * 86400 }
  );
  return response;
}
