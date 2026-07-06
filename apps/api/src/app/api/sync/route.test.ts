import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  lastSyncedAt: null as string | null,
}));

const runSyncMock = vi.hoisted(() => vi.fn(async () => 5));
const healMock = vi.hoisted(() => vi.fn(async () => 3));

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
    state.lastSyncedAt = null;
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
