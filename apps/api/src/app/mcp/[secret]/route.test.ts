import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "./route";
import { TOOL_NAMES } from "@floaters/mcp-tools";

const SECRET = "test-secret-with-enough-length";

function rpc(secret: string, body: unknown, method = "POST"): [NextRequest, { params: Promise<{ secret: string }> }] {
  const req = new NextRequest(`http://localhost:3000/mcp/${secret}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  return [req, { params: Promise.resolve({ secret }) }];
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
};

describe("/mcp/[secret]", () => {
  const original = process.env.MCP_SECRET;
  beforeEach(() => {
    process.env.MCP_SECRET = SECRET;
  });
  afterEach(() => {
    process.env.MCP_SECRET = original;
  });

  it("404s on the wrong secret", async () => {
    const res = await POST(...rpc("nope-nope-nope-nope-nope", initialize));
    expect(res.status).toBe(404);
  });

  it("404s everywhere when MCP_SECRET is unset or too short", async () => {
    delete process.env.MCP_SECRET;
    expect((await POST(...rpc(SECRET, initialize))).status).toBe(404);
    process.env.MCP_SECRET = "short";
    expect((await POST(...rpc("short", initialize))).status).toBe(404);
  });

  it("answers initialize as the floaters server, stateless, never cached", async () => {
    const res = await POST(...rpc(SECRET, initialize));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("floaters");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it("lists the same seven read-only tools as the stdio server", async () => {
    const res = await POST(...rpc(SECRET, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
  });

  it("rejects the SSE stream GET in stateless mode rather than hanging", async () => {
    const res = await GET(...rpc(SECRET, undefined, "GET"));
    expect(res.status).toBe(405);
  });
});
