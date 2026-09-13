import { timingSafeEqual } from "node:crypto";
import type { ApiGet } from "@floaters/mcp-tools";

// Remote MCP endpoint support. The endpoint lives at /mcp/<MCP_SECRET>: the
// secret in the path is the whole access control (claude.ai custom connectors
// send no credentials), so it must be its own value, never CONNECT_SECRET,
// which ships inside the web bundle. With MCP_SECRET unset the endpoint does
// not exist (404 for every path).

export function mcpSecretMatches(candidate: string): boolean {
  const expected = process.env.MCP_SECRET?.trim();
  if (!expected || expected.length < 16) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * GETs against this same API over loopback, authenticated with the API key.
 * Tool calls therefore read exactly what the web app reads, and can't reach
 * anything the API's own auth would refuse.
 */
export function localApiGet(base = `http://127.0.0.1:${process.env.PORT ?? 3000}`): ApiGet {
  return async <T = unknown>(path: string, params?: Record<string, string | number | undefined>) => {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.CONNECT_SECRET ?? ""}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GET ${path} failed: ${res.status} ${res.statusText} ${body}`.trim());
    }
    return (await res.json()) as T;
  };
}
