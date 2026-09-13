import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const togglRequestMock = vi.hoisted(() =>
  vi.fn<(path: string, params?: Record<string, unknown>) => Promise<unknown>>()
);
const upsertMock = vi.hoisted(() => vi.fn(async (_table: string, _rows: unknown) => ({ error: null })));
const state = vi.hoisted(() => ({
  stateRow: null as Record<string, unknown> | null,
  stateUpserts: [] as Record<string, unknown>[],
}));

vi.mock("./client", () => ({
  togglRequest: togglRequestMock,
  isTogglConfigured: () => true,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: table === "toggl_state" ? state.stateRow : null, error: null }),
        upsert: async (rows: Record<string, unknown> | Record<string, unknown>[]) => {
          if (table === "toggl_state") state.stateUpserts.push(rows as Record<string, unknown>);
          else await upsertMock(table, rows);
          return { error: null };
        },
      };
      return builder;
    },
  },
}));

import { mapTimeEntry, mapProject, mapClient, historyWindows, runTogglSync, fetchProjects } from "./sync";
import type { TogglTimeEntry } from "@/types/toggl";

describe("mapTimeEntry", () => {
  const base: TogglTimeEntry = {
    id: 1,
    workspace_id: 7,
    project_id: 10,
    description: "Deck",
    start: "2026-09-09T08:00:00+00:00",
    stop: "2026-09-09T09:00:00+00:00",
    duration: 3600,
    billable: true,
    tags: ["client"],
    at: "2026-09-09T09:00:01+00:00",
    project_name: "Acme retainer",
    client_name: "Acme Ltd",
  };

  it("maps a stopped entry with its duration and meta names", () => {
    const row = mapTimeEntry("conn", base);
    expect(row).toMatchObject({
      connection_id: "conn",
      toggl_id: 1,
      project_id: 10,
      project_name: "Acme retainer",
      client_name: "Acme Ltd",
      start: "2026-09-09T08:00:00.000Z",
      stop: "2026-09-09T09:00:00.000Z",
      duration_seconds: 3600,
      billable: true,
      tags: ["client"],
      deleted_at: null,
    });
  });

  it("stores a running entry (negative duration, no stop) with a null duration", () => {
    const row = mapTimeEntry("conn", { ...base, stop: null, duration: -1757404800 });
    expect(row.stop).toBeNull();
    expect(row.duration_seconds).toBeNull();
  });

  it("keeps deletions as deleted_at rather than dropping the row", () => {
    const row = mapTimeEntry("conn", { ...base, server_deleted_at: "2026-09-10T00:00:00Z" });
    expect(row.deleted_at).toBe("2026-09-10T00:00:00.000Z");
  });

  it("defaults missing tags and billable", () => {
    const row = mapTimeEntry("conn", { ...base, tags: null, billable: undefined as unknown as boolean });
    expect(row.tags).toEqual([]);
    expect(row.billable).toBe(false);
  });
});

describe("mapProject / mapClient", () => {
  it("never writes the local client_key link column", () => {
    const row = mapClient("conn", { id: 1, wid: 7, name: "Acme", archived: false });
    expect(row).not.toHaveProperty("client_key");
    expect(row).toMatchObject({ toggl_id: 1, name: "Acme", archived: false });
  });

  it("treats a server-deleted project as inactive", () => {
    const row = mapProject("conn", { id: 1, workspace_id: 7, client_id: 3, name: "Old", active: true, server_deleted_at: "2026-01-01T00:00:00Z" });
    expect(row.active).toBe(false);
    expect(row.toggl_client_id).toBe(3);
  });
});

describe("historyWindows", () => {
  it("walks month by month from HISTORY_MONTHS back through the current month", () => {
    const windows = historyWindows(new Date("2026-09-13T10:00:00Z"), 3);
    expect(windows).toEqual([
      { start: "2026-06-01", end: "2026-07-01" },
      { start: "2026-07-01", end: "2026-08-01" },
      { start: "2026-08-01", end: "2026-09-01" },
      { start: "2026-09-01", end: "2026-10-01" },
    ]);
  });
});

describe("fetchProjects", () => {
  beforeEach(() => togglRequestMock.mockReset());

  it("pages until a short page and accepts a bare array or an items envelope", async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, name: `p${i}` }));
    togglRequestMock.mockResolvedValueOnce(full).mockResolvedValueOnce({ items: [{ id: 999, name: "last" }] });
    const projects = await fetchProjects(7);
    expect(projects).toHaveLength(201);
    expect(togglRequestMock).toHaveBeenNthCalledWith(1, "/workspaces/7/projects", { active: "both", per_page: 200, page: 1 });
    expect(togglRequestMock).toHaveBeenNthCalledWith(2, "/workspaces/7/projects", { active: "both", per_page: 200, page: 2 });
  });
});

describe("runTogglSync", () => {
  beforeEach(() => {
    togglRequestMock.mockReset();
    upsertMock.mockClear();
    state.stateRow = null;
    state.stateUpserts = [];
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T10:00:00Z"));
    delete process.env.TOGGL_WORKSPACE_ID;
  });
  afterEach(() => vi.useRealTimers());

  function respond(path: string, params?: Record<string, unknown>) {
    if (path === "/me") return { id: 1, default_workspace_id: 7 };
    if (path.endsWith("/clients")) return [{ id: 1, wid: 7, name: "Acme" }];
    if (path.endsWith("/projects")) return [{ id: 10, workspace_id: 7, client_id: 1, name: "Retainer", active: true }];
    if (path === "/me/time_entries") {
      return [{ id: Number(String(params?.start_date ?? params?.since).replace(/\D/g, "").slice(-6)), workspace_id: 7, project_id: 10, start: "2026-09-01T08:00:00Z", stop: "2026-09-01T09:00:00Z", duration: 3600, billable: true }];
    }
    throw new Error(`unexpected ${path}`);
  }

  it("does a full month-by-month walk on the first sync and resolves the workspace from /me", async () => {
    togglRequestMock.mockImplementation(async (path: string, params?: Record<string, unknown>) => respond(path, params));
    const result = await runTogglSync("conn");
    expect(result.full).toBe(true);
    expect(result.workspaceId).toBe(7);
    const entryCalls = togglRequestMock.mock.calls.filter((c) => c[0] === "/me/time_entries");
    expect(entryCalls).toHaveLength(13); // 12 months back + the current month
    expect(entryCalls[0][1]).toMatchObject({ start_date: "2025-09-01", end_date: "2025-10-01", meta: true });
    expect(entryCalls[12][1]).toMatchObject({ start_date: "2026-09-01", end_date: "2026-10-01" });
    const tables = upsertMock.mock.calls.map((c) => c[0]);
    expect(tables).toEqual(["toggl_clients", "toggl_projects", "toggl_time_entries"]);
    const final = state.stateUpserts[state.stateUpserts.length - 1];
    expect(final).toMatchObject({ sync_status: "idle", workspace_id: 7, last_synced_at: "2026-09-13T10:00:00.000Z" });
  });

  it("uses the since cursor (with an hour of overlap) on a recent incremental sync", async () => {
    state.stateRow = { workspace_id: 7, last_synced_at: "2026-09-12T10:00:00Z" };
    togglRequestMock.mockImplementation(async (path: string, params?: Record<string, unknown>) => respond(path, params));
    const result = await runTogglSync("conn");
    expect(result.full).toBe(false);
    expect(togglRequestMock.mock.calls.some((c) => c[0] === "/me")).toBe(false);
    const entryCalls = togglRequestMock.mock.calls.filter((c) => c[0] === "/me/time_entries");
    expect(entryCalls).toHaveLength(1);
    expect(entryCalls[0][1]).toEqual({ since: Math.floor(new Date("2026-09-12T09:00:00Z").getTime() / 1000), meta: true });
  });

  it("falls back to a full walk when the cursor is too old for Toggl's since window", async () => {
    state.stateRow = { workspace_id: 7, last_synced_at: "2026-05-01T10:00:00Z" };
    togglRequestMock.mockImplementation(async (path: string, params?: Record<string, unknown>) => respond(path, params));
    const result = await runTogglSync("conn");
    expect(result.full).toBe(true);
  });

  it("records the error on toggl_state and rethrows", async () => {
    togglRequestMock.mockRejectedValue(new Error("Toggl API error (403)"));
    await expect(runTogglSync("conn")).rejects.toThrow(/403/);
    const final = state.stateUpserts[state.stateUpserts.length - 1];
    expect(final).toMatchObject({ sync_status: "error", sync_error: "Toggl API error (403)" });
  });

  it("prefers TOGGL_WORKSPACE_ID over /me", async () => {
    process.env.TOGGL_WORKSPACE_ID = "42";
    togglRequestMock.mockImplementation(async (path: string, params?: Record<string, unknown>) => respond(path, params));
    const result = await runTogglSync("conn");
    expect(result.workspaceId).toBe(42);
    expect(togglRequestMock.mock.calls.some((c) => c[0] === "/me")).toBe(false);
    expect(togglRequestMock.mock.calls.some((c) => c[0] === "/workspaces/42/clients")).toBe(true);
  });
});
