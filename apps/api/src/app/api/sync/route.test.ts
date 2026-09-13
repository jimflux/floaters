import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  lastSyncedAt: null as string | null,
}));

const runSyncMock = vi.hoisted(() => vi.fn(async () => 5));
const healMock = vi.hoisted(() => vi.fn(async () => 3));
const togglState = vi.hoisted(() => ({ configured: false }));
const runTogglSyncMock = vi.hoisted(() =>
  vi.fn(async () => ({ clients: 1, projects: 2, entries: 3, workspaceId: 9, full: false }))
);

vi.mock("@/lib/toggl/client", () => ({
  isTogglConfigured: () => togglState.configured,
}));

vi.mock("@/lib/toggl/sync", () => ({
  runTogglSync: runTogglSyncMock,
}));

vi.mock("@/lib/api-helpers", () => ({
  requireConnection: async () => "conn",
  json: (data: unknown) => data,
  handleError: (err: unknown) => {
    throw err;
  },
}));

vi.mock("@/lib/xero/sync", () => ({
  runSync: runSyncMock,
  healInvoiceStatuses: healMock,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { last_synced_at: state.lastSyncedAt } }),
        }),
      }),
    }),
  },
}));

import { POST } from "./route";

function request(body?: unknown): NextRequest {
  return {
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as unknown as NextRequest;
}

describe("POST /api/sync", () => {
  beforeEach(() => {
    runSyncMock.mockClear();
    healMock.mockClear();
    runTogglSyncMock.mockClear();
    state.lastSyncedAt = null;
    togglState.configured = false;
  });

  it("skips Toggl when TOGGL_API_TOKEN is not configured", async () => {
    const result = (await POST(request())) as unknown as { toggl: unknown };
    expect(runTogglSyncMock).not.toHaveBeenCalled();
    expect(result.toggl).toBeNull();
  });

  it("runs the Toggl sync after Xero when configured and reports it", async () => {
    togglState.configured = true;
    const result = (await POST(request({ full: true }))) as unknown as {
      toggl: { ok: boolean; result: { entries: number } };
    };
    expect(runSyncMock).toHaveBeenCalledWith("conn", true);
    expect(runTogglSyncMock).toHaveBeenCalledWith("conn", { full: true });
    expect(result.toggl.ok).toBe(true);
    expect(result.toggl.result.entries).toBe(3);
  });

  it("reports a Toggl failure without failing the Xero sync", async () => {
    togglState.configured = true;
    runTogglSyncMock.mockRejectedValueOnce(new Error("Toggl API error (403)"));
    const result = (await POST(request())) as unknown as {
      ok: boolean;
      recordsSynced: number;
      toggl: { ok: boolean; error: string };
    };
    expect(result.ok).toBe(true);
    expect(result.recordsSynced).toBe(5);
    expect(result.toggl.ok).toBe(false);
    expect(result.toggl.error).toMatch(/403/);
  });

  it("runs a full sync when the connection has never synced", async () => {
    await POST(request());
    expect(runSyncMock).toHaveBeenCalledWith("conn", true);
  });

  it("runs incrementally when last_synced_at exists", async () => {
    state.lastSyncedAt = "2026-06-15T10:00:00.000Z";
    await POST(request());
    expect(runSyncMock).toHaveBeenCalledWith("conn", false);
  });

  it("forces a full sync with { full: true }", async () => {
    state.lastSyncedAt = "2026-06-15T10:00:00.000Z";
    await POST(request({ full: true }));
    expect(runSyncMock).toHaveBeenCalledWith("conn", true);
  });

  it("runs the invoice-status heal with { heal: true } and reports the count", async () => {
    state.lastSyncedAt = "2026-06-15T10:00:00.000Z";
    const result = (await POST(request({ heal: true }))) as unknown as {
      healed: number;
    };
    expect(healMock).toHaveBeenCalledWith("conn");
    expect(result.healed).toBe(3);
  });

  it("does not heal on a routine sync", async () => {
    await POST(request());
    expect(healMock).not.toHaveBeenCalled();
  });

  it("degrades to a routine sync when the body is JSON null", async () => {
    await POST(request(null));
    expect(runSyncMock).toHaveBeenCalledWith("conn", true);
    expect(healMock).not.toHaveBeenCalled();
  });

  it("degrades to a routine sync when a flag has the wrong type", async () => {
    await POST(request({ heal: "true" }));
    expect(healMock).not.toHaveBeenCalled();
  });
});
