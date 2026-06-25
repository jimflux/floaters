import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  "https://floaters.flux.am",
  "https://flux-floaters.lovable.app",
  "http://localhost:5173",
  "http://localhost:3000",
].filter(Boolean) as string[];

const ALLOWED_ORIGIN_PATTERNS = [/^https:\/\/id-preview--.*\.lovable\.app$/];

function isAllowedOrigin(origin: string | null): origin is string {
  if (!origin) return false;
  return (
    ALLOWED_ORIGINS.includes(origin) ||
    ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))
  );
}

function buildCorsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

export function middleware(request: NextRequest) {
  const origin = request.headers.get("origin");
  const originAllowed = isAllowedOrigin(origin);

  if (request.method === "OPTIONS") {
    if (!originAllowed || !origin) {
      return new NextResponse(null, { status: 403 });
    }

    return new NextResponse(null, {
      status: 204,
      headers: buildCorsHeaders(origin),
    });
  }

  const response = NextResponse.next();

  if (originAllowed && origin) {
    for (const [key, value] of Object.entries(buildCorsHeaders(origin))) {
      response.headers.set(key, value);
    }
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*", "/auth/:path*"],
};
