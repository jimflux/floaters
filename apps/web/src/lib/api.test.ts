import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { getCashflow, patchVat, triggerSync, CASHFLOW_CACHE_KEY } from "./api";
import { SignInRequiredError } from "./session";

const fetchMock = vi.fn();
const assign = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  assign.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { href: "https://floaters.flux.am/?view=projected", assign });
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200 });

describe("api requests", () => {
  it("are same-origin, send the session cookie and the web client header, and no API key", async () => {
    fetchMock.mockResolvedValue(ok());
    await getCashflow();
    await triggerSync();
    await patchVat({ enabled: true });
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toMatch(/^\/api\//);
      expect(init.credentials).toBe("same-origin");
      expect(init.headers["X-Floaters-Client"]).toBe("web");
      expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
    }
    expect(fetchMock.mock.calls[2][1].headers["Content-Type"]).toBe("application/json");
  });

  it("sends Jim to login.flux.am on a 401, back to this page", async () => {
    localStorage.setItem(CASHFLOW_CACHE_KEY, "{}");
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    void getCashflow();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(assign).toHaveBeenCalledWith(
      "https://login.flux.am/?next=" + encodeURIComponent("https://floaters.flux.am/?view=projected")
    );
    // Cached figures don't outlive the session.
    expect(localStorage.getItem(CASHFLOW_CACHE_KEY)).toBeNull();
  });

  it("doesn't redirect twice within a minute, and asks for a sign-in instead", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    void getCashflow();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    await expect(getCashflow()).rejects.toBeInstanceOf(SignInRequiredError);
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("doesn't redirect when the guard can't be stored", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(getCashflow()).rejects.toBeInstanceOf(SignInRequiredError);
    expect(assign).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("doesn't redirect on a 403", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
    await expect(getCashflow()).rejects.toThrow("403");
    expect(assign).not.toHaveBeenCalled();
  });

  it("clears the guard once a request gets through", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    void getCashflow();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    fetchMock.mockResolvedValueOnce(ok());
    await getCashflow();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    void getCashflow();
    await vi.waitFor(() => expect(assign).toHaveBeenCalledTimes(2));
  });
});

describe("the API key is gone from the web app", () => {
  // Built from parts so this file doesn't match itself.
  const NAME = ["VITE", "API", "KEY"].join("_");
  const root = path.resolve(__dirname, "../../../..");
  const SKIP = new Set(["node_modules", ".git", "dist", ".next", "public", ".temp"]);

  function* files(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) yield* files(full);
      // .env files are never read (they may hold secrets); package-lock is noise.
      else if (!entry.startsWith(".env") && entry !== "package-lock.json") yield full;
    }
  }

  // Covers code, tests and docs. .env and .env.example files are skipped
  // because agents here may not read them, so check those by hand.
  it(`isn't referenced anywhere in the repo`, () => {
    const hits = [...files(root)].filter((f) => readFileSync(f, "utf8").includes(NAME));
    expect(hits).toEqual([]);
  });
});
