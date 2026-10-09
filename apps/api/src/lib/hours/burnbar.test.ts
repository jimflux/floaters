import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchBurnBar, loadBurnBar, readBurnBar, isBurnBarConfigured, resetBurnBarCache, CACHE_MS } from "./burnbar";

const URL_BASE = "https://burnbar.test";
const TOKEN = "test-read-key";

const state = {
  clients: [{ id: 68438745, name: "Propellernet", archived: false, updatedAt: "2026-10-01T00:00:00Z", deleted: false }],
  projects: [{ id: 10_000_000_003, clientId: 68438745, name: "Boshing", archived: false, updatedAt: "2026-10-01T00:00:00Z", deleted: false }],
  running: [],
  recent: [],
  today: [],
  hidden: {
    clients: [{ id: 17580262, name: "IKEA", archived: true, updatedAt: "2026-10-01T00:00:00Z", deleted: false }],
    projects: [],
  },
  serverTime: "2026-10-09T10:00:00Z",
};

const entryA = {
  id: "6F9619FF-8B86-D011-B42D-00C04FC964FF",
  description: "",
  clientId: 68438745,
  projectId: null,
  start: "2026-10-08T08:35:00Z",
  end: "2026-10-08T09:35:00Z",
  away: false,
  updatedAt: "2026-10-08T09:35:00Z",
  deleted: false,
};
const entryB = { ...entryA, id: "11111111-2222-3333-4444-555555555555", start: "2026-02-01T09:00:00Z", end: null };

function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const fakeBurnBar = async (input: string | URL | Request) => {
  const url = new URL(String(input));
  if (url.pathname === "/api/state") return ok(state);
  if (url.pathname === "/api/entries") {
    // Each window returns only the entries starting inside it, like BurnBar.
    const from = Date.parse(url.searchParams.get("from")!);
    const to = Date.parse(url.searchParams.get("to")!);
    // The Mac sends uppercase ids; a lowercase copy of the same entry is the same entry.
    const all = [entryA, entryB, { ...entryA, id: entryA.id.toLowerCase() }];
    return ok({ entries: all.filter((e) => Date.parse(e.start) >= from && Date.parse(e.start) < to) });
  }
  return new Response("not found", { status: 404 });
};
const fetchMock = vi.fn(fakeBurnBar);

beforeEach(() => {
  vi.stubEnv("BURNBAR_URL", `${URL_BASE}/`);
  vi.stubEnv("BURNBAR_READ_TOKEN", TOKEN);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
  fetchMock.mockImplementation(fakeBurnBar);
  resetBurnBarCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("BurnBar config", () => {
  it("needs both the URL and the read key", () => {
    expect(isBurnBarConfigured()).toBe(true);
    vi.stubEnv("BURNBAR_READ_TOKEN", "");
    expect(isBurnBarConfigured()).toBe(false);
    vi.stubEnv("BURNBAR_READ_TOKEN", TOKEN);
    vi.stubEnv("BURNBAR_URL", "");
    expect(isBurnBarConfigured()).toBe(false);
  });
});

describe("fetchBurnBar", () => {
  it("reads state and entries with the read key as a bearer token", async () => {
    await fetchBurnBar(new Date("2026-10-09T10:00:00Z"));
    for (const [input, init] of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(String(input).startsWith(`${URL_BASE}/api/`)).toBe(true);
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("reads entries from 1 January 2026, at most 400 days per call", async () => {
    // 1 Jan 2026 to 11 Feb 2027 (now + 2 days) is 407 days: two windows.
    await fetchBurnBar(new Date("2027-02-09T10:00:00Z"));
    const windows = fetchMock.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((u) => u.pathname === "/api/entries")
      .map((u) => [u.searchParams.get("from"), u.searchParams.get("to")]);
    expect(windows).toEqual([
      ["2026-01-01T00:00:00.000Z", "2027-02-05T00:00:00.000Z"],
      ["2027-02-05T00:00:00.000Z", "2027-02-11T10:00:00.000Z"],
    ]);
  });

  it("merges visible and hidden clients, and de-duplicates entries by id regardless of case", async () => {
    const data = await fetchBurnBar(new Date("2026-10-09T10:00:00Z"));
    expect(data.clients.map((c) => c.name)).toEqual(["Propellernet", "IKEA"]);
    expect(data.projects.map((p) => p.id)).toEqual([10_000_000_003]);
    expect(data.entries.map((e) => e.id)).toEqual([entryB.id, entryA.id]); // ordered by start
    expect(data.entries[0]).toMatchObject({ end: null, projectId: null, clientId: 68438745 });
    expect(data.fetchedAt).toBe("2026-10-09T10:00:00.000Z");
  });

  it("fails with the status, never the key, when BurnBar refuses", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("{}", { status: 401 }));
    const failure = fetchBurnBar(new Date("2026-10-09T10:00:00Z"));
    await expect(failure).rejects.toThrow(/returned 401/);
    await expect(failure).rejects.not.toThrow(new RegExp(TOKEN));
  });

  it("rejects a response in the wrong shape", async () => {
    fetchMock.mockImplementationOnce(async () => ok({ clients: "nope" }));
    await expect(fetchBurnBar(new Date("2026-10-09T10:00:00Z"))).rejects.toThrow(/unexpected shape/);
  });
});

describe("loadBurnBar / readBurnBar", () => {
  it("keeps a read for a minute, shares concurrent reads, and fresh skips the copy", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
    const [a, b] = await Promise.all([loadBurnBar(), loadBurnBar()]);
    expect(a).toBe(b);
    const calls = fetchMock.mock.calls.length;
    await loadBurnBar();
    expect(fetchMock.mock.calls.length).toBe(calls);
    vi.setSystemTime(new Date(Date.parse("2026-10-09T10:00:00Z") + CACHE_MS + 1));
    await loadBurnBar();
    expect(fetchMock.mock.calls.length).toBe(calls * 2);
    await loadBurnBar({ fresh: true });
    expect(fetchMock.mock.calls.length).toBe(calls * 3);
  });

  it("returns the last good copy with the error when a read fails", async () => {
    const first = await readBurnBar();
    expect(first.error).toBeNull();
    fetchMock.mockImplementation(async () => new Response("down", { status: 502 }));
    const second = await readBurnBar({ fresh: true });
    expect(second.error).toMatch(/returned 502/);
    expect(second.data).toBe(first.data);
    resetBurnBarCache();
    expect(await readBurnBar()).toEqual({ data: null, error: expect.stringMatching(/502/) });
  });

  it("waits before retrying after a failed read, unless fresh", async () => {
    fetchMock.mockImplementation(async () => new Response("down", { status: 502 }));
    await readBurnBar();
    const calls = fetchMock.mock.calls.length;
    expect((await readBurnBar()).error).toMatch(/502/);
    expect(fetchMock.mock.calls.length).toBe(calls);
    await readBurnBar({ fresh: true });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
  });
});
