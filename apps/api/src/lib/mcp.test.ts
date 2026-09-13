import { describe, it, expect, afterEach, vi } from "vitest";
import { mcpSecretMatches, localApiGet } from "./mcp";

describe("mcpSecretMatches", () => {
  const original = process.env.MCP_SECRET;
  afterEach(() => {
    process.env.MCP_SECRET = original;
  });

  it("matches only the exact configured secret", () => {
    process.env.MCP_SECRET = "abcdefghijklmnopqrstuvwxyz";
    expect(mcpSecretMatches("abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(mcpSecretMatches("abcdefghijklmnopqrstuvwxyZ")).toBe(false);
    expect(mcpSecretMatches("abcdefghijklmnopqrstuvwxy")).toBe(false);
    expect(mcpSecretMatches("")).toBe(false);
  });

  it("never matches when unset or shorter than 16 characters", () => {
    delete process.env.MCP_SECRET;
    expect(mcpSecretMatches("anything")).toBe(false);
    process.env.MCP_SECRET = "tooshort";
    expect(mcpSecretMatches("tooshort")).toBe(false);
  });
});

describe("localApiGet", () => {
  it("GETs the API over loopback with the API key and drops empty params", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    process.env.CONNECT_SECRET = "key";
    const get = localApiGet("http://127.0.0.1:4321");
    const data = await get("/api/time", { back: 3, forward: undefined, from: "" });
    expect(data).toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("http://127.0.0.1:4321/api/time?back=3");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key");
    vi.unstubAllGlobals();
  });

  it("throws with the status on a failed GET", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401, statusText: "Unauthorized" })));
    await expect(localApiGet("http://127.0.0.1:4321")("/api/time")).rejects.toThrow(/401/);
    vi.unstubAllGlobals();
  });
});
