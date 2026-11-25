import { timingSafeEqual } from "node:crypto";
import { createApiClient } from "@floaters/mcp-tools";

// Remote MCP capability URLs use separate read and write secrets, never the
// application's CONNECT_SECRET. Missing credentials do not expose a scope.

export function mcpSecretMatches(candidate: string): boolean {
  const expected = process.env.MCP_SECRET?.trim();
  if (!expected || expected.length < 16) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Resolve scopes without ever upgrading an existing read-only URL. */
export function mcpAccess(candidate: string): 'read' | 'write' | null {
  if (mcpSecretMatches(candidate)) return 'read';
  const expected = process.env.MCP_WRITE_SECRET?.trim();
  if (!expected || expected.length < 16 || expected === process.env.MCP_SECRET?.trim() || expected === process.env.CONNECT_SECRET?.trim()) return null;
  const a = Buffer.from(candidate), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? 'write' : null;
}

export function localApiClient(base = `http://127.0.0.1:${process.env.PORT ?? 3000}`) {
  return createApiClient(() => ({ base, key: process.env.CONNECT_SECRET ?? '' }));
}
export function localApiGet(base?: string) { return localApiClient(base).get; }
