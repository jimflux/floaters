import { NextResponse } from "next/server";

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  "https://floaters.flux.am",
  "https://flux-floaters.lovable.app",
  "http://localhost:5173",
  "http://localhost:3000",
].filter(Boolean) as string[];

const ALLOWED_ORIGIN_PATTERNS = [/^https:\/\/id-preview--.*\.lovable\.app$/];

function resolveAllowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  if (ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin))) {
    return origin;
  }
  return null;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = resolveAllowedOrigin(origin) ?? ALLOWED_ORIGINS[0] ?? "http://localhost:5173";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

export function withCors(response: NextResponse, origin: string | null): NextResponse {
  const headers = corsHeaders(origin);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

export function corsPreflightResponse(origin: string | null): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}
