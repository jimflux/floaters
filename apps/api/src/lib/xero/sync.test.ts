import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Supabase singleton before importing the module under test.
const upsertMock = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { from: () => ({ upsert: upsertMock }) },
}));

import { parseXeroDate, parseXeroDateTime, chunkedUpsert } from "./sync";

describe("parseXeroDate", () => {
  it("parses Xero's /Date(ms+offset)/ format to a UTC yyyy-MM-dd", () => {
    expect(parseXeroDate("/Date(0+0000)/")).toBe("1970-01-01");
    // 1700000000000ms = 2023-11-14T22:13:20Z
    expect(parseXeroDate("/Date(1700000000000)/")).toBe("2023-11-14");
  });

  it("parses a date-only ISO string", () => {
    expect(parseXeroDate("2024-01-15")).toBe("2024-01-15");
  });

  it("returns null for empty / invalid input", () => {
    expect(parseXeroDate(null)).toBeNull();
    expect(parseXeroDate(undefined)).toBeNull();
    expect(parseXeroDate("")).toBeNull();
    expect(parseXeroDate("not a date")).toBeNull();
  });
});

describe("parseXeroDateTime", () => {
  it("parses /Date(ms)/ to a full ISO timestamp", () => {
    expect(parseXeroDateTime("/Date(0)/")).toBe("1970-01-01T00:00:00.000Z");
  });

  it("returns null for invalid input", () => {
    expect(parseXeroDateTime(null)).toBeNull();
    expect(parseXeroDateTime("garbage")).toBeNull();
  });
});

describe("chunkedUpsert", () => {
  beforeEach(() => {
    upsertMock.mockReset();
    upsertMock.mockResolvedValue({ error: null });
  });

  it("splits rows into chunks of 500 and preserves total count", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({ id: i }));
    await chunkedUpsert("xero_invoices", rows, "connection_id,xero_id");

    expect(upsertMock).toHaveBeenCalledTimes(3);
    const sizes = upsertMock.mock.calls.map((c) => (c[0] as unknown[]).length);
    expect(sizes).toEqual([500, 500, 200]);
    // onConflict is forwarded
    expect(upsertMock.mock.calls[0][1]).toEqual({ onConflict: "connection_id,xero_id" });
  });

  it("does nothing for an empty array", async () => {
    await chunkedUpsert("xero_invoices", [], "connection_id,xero_id");
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("throws when a chunk fails", async () => {
    upsertMock.mockResolvedValueOnce({ error: { message: "boom" } });
    await expect(
      chunkedUpsert("xero_invoices", [{ id: 1 }], "connection_id,xero_id")
    ).rejects.toThrow(/boom/);
  });
});
