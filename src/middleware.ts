import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL || "http://localhost:5173",
  "http://localhost:3000",
].filter(Boolean);

export function middleware(request: NextRequest) {
  const origin = request.headers.get("origin");

  const isAllowedOrigin = origin && ALLOWED_ORIGINS.includes(origin);

  // Handle CORS preflight — reject unknown origins
  if (request.method === "OPTIONS") {
    if (!isAllowedOrigin) {
      return new NextResponse(null, { status: 403 });
    }
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Credentials": "true",
      },
    });
  }

  const response = NextResponse.next();

  // Add CORS headers only for allowed origins
  if (isAllowedOrigin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*", "/auth/:path*"],
};
