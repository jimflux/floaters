import { timingSafeEqual } from "node:crypto";
import { createApiClient } from "@floaters/mcp-tools";

// One remote MCP connection exposes reads and forecast writes. The earlier
// separate write credential remains accepted as an alias so existing clients work.

export function mcpSecretMatches(candidate: string): boolean {
  const expected = process.env.MCP_SECRET?.trim();
  if (!expected || expected.length < 16) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Authenticate the canonical URL or the previously issued write-URL alias. */
export function mcpAccess(candidate: string): boolean {
  if (mcpSecretMatches(candidate)) return true;
  const expected = process.env.MCP_WRITE_SECRET?.trim();
  if (!expected || expected.length < 16 || expected === process.env.CONNECT_SECRET?.trim()) return false;
  const a = Buffer.from(candidate), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function localApiClient(base = `http://127.0.0.1:${process.env.PORT ?? 3000}`) {
  return createApiClient(() => ({ base, key: process.env.CONNECT_SECRET ?? '' }));
}
export function localApiGet(base?: string) { return localApiClient(base).get; }
