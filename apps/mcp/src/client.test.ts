import { describe, it, expect, vi, afterEach } from "vitest";

async function loadClient(env: { url?: string; key?: string }) {
  vi.resetModules();
  vi.stubEnv("FLOATERS_API_URL", env.url ?? "");
  vi.stubEnv("FLOATERS_API_KEY", env.key ?? "");
  return import("./client");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("apiGet config", () => {
  it("throws a clear error when FLOATERS_API_URL is missing", async () => {
    const { apiGet } = await loadClient({ key: "k" });
    await expect(apiGet("/api/cashflow")).rejects.toThrow(/FLOATERS_API_URL/);
  });

  it("throws a clear error when FLOATERS_API_KEY is missing", async () => {
    const { apiGet } = await loadClient({ url: "https://api.test" });
    await expect(apiGet("/api/cashflow")).rejects.toThrow(/FLOATERS_API_KEY/);
  });
});

describe("apiGet requests", () => {
  it("builds the URL with params, strips the trailing slash, and sends the bearer token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    const { apiGet } = await loadClient({ url: "https://api.test/", key: "secret" });
    vi.stubGlobal("fetch", fetchMock);

    const result = await apiGet("/api/cashflow", { back: 3, forward: undefined });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url.toString()).toBe("https://api.test/api/cashflow?back=3");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
  });

  it("throws on a non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "boom",
    });
    const { apiGet } = await loadClient({ url: "https://api.test", key: "secret" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet("/api/cashflow")).rejects.toThrow(/500/);
  });
});
