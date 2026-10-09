import { describe, it, expect, beforeEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { BurnBarData } from "@/lib/hours/burnbar";

const hoisted = vi.hoisted(() => ({
  configured: true,
  read: { data: null as BurnBarData | null, error: null as string | null },
  load: vi.fn(),
  saveLink: vi.fn(async (..._args: unknown[]) => ({ error: null as string | null })),
}));

vi.mock("@/lib/api-helpers", () => ({
  requireConnection: async () => "conn",
  json: (data: unknown, status = 200) => ({ status, body: data }),
  error: (message: string, status = 400) => ({ status, body: { error: message } }),
  handleError: (err: unknown) => {
    throw err;
  },
}));

vi.mock("@/lib/hours/burnbar", () => ({
  HOURS_TIME_ZONE: "Europe/London",
  isBurnBarConfigured: () => hoisted.configured,
  readBurnBar: async () => hoisted.read,
  loadBurnBar: hoisted.load,
}));

vi.mock("@/lib/hours/store", () => ({
  fetchClientLinks: async () => new Map(),
  fetchLinkOptions: async () => [],
  fetchInvoicedByClientMonth: async () => new Map(),
  saveClientLink: hoisted.saveLink,
}));

import { GET, PATCH } from "./route";

type Result = { status: number; body: Record<string, unknown> };
const getRequest = (query = "") => ({ url: `https://floaters.test/api/time${query}` }) as unknown as NextRequest;
const patchRequest = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;

const data: BurnBarData = {
  clients: [{ id: 68438745, name: "Propellernet", archived: false, deleted: false }],
  projects: [],
  entries: [],
  fetchedAt: "2026-10-09T10:00:00.000Z",
};

beforeEach(() => {
  hoisted.configured = true;
  hoisted.read = { data, error: null };
  hoisted.load.mockReset();
  hoisted.load.mockResolvedValue(data);
  hoisted.saveLink.mockClear();
});

describe("GET /api/time", () => {
  it("says BurnBar isn't set up, rather than erroring, when the env is missing", async () => {
    hoisted.configured = false;
    const res = (await GET(getRequest())) as unknown as Result;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: false, clients: [], running: null, syncError: null });
  });

  it("reports a failed BurnBar read in syncError without failing the request", async () => {
    hoisted.read = { data: null, error: "BurnBar /api/state returned 502" };
    const res = (await GET(getRequest())) as unknown as Result;
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, syncStatus: "error", syncError: "BurnBar /api/state returned 502" });
  });

  it("uses the read time as lastSyncedAt", async () => {
    const res = (await GET(getRequest("?back=3&forward=12"))) as unknown as Result;
    expect(res.body).toMatchObject({ configured: true, syncStatus: "idle", lastSyncedAt: "2026-10-09T10:00:00.000Z", timeZone: "Europe/London" });
    expect((res.body.months as string[]).length).toBe(15);
  });
});

describe("PATCH /api/time", () => {
  it("stores a link keyed by the BurnBar client id, with its name", async () => {
    const res = (await PATCH(patchRequest({ togglClientId: 68438745, clientKey: "contact:pnet" }))) as unknown as Result;
    expect(res.status).toBe(200);
    expect(hoisted.saveLink).toHaveBeenCalledWith("conn", data.clients[0], "contact:pnet");
  });

  it("404s for a client BurnBar doesn't know", async () => {
    const res = (await PATCH(patchRequest({ togglClientId: 5, clientKey: null }))) as unknown as Result;
    expect(res.status).toBe(404);
    expect(hoisted.saveLink).not.toHaveBeenCalled();
  });

  it("409s when BurnBar isn't set up", async () => {
    hoisted.configured = false;
    const res = (await PATCH(patchRequest({ togglClientId: 68438745, clientKey: null }))) as unknown as Result;
    expect(res.status).toBe(409);
  });
});
