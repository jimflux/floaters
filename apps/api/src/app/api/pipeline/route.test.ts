import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  projections: [] as Record<string, unknown>[],
  invoices: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/api-helpers", () => ({
  requireConnection: async () => "conn",
  json: (data: unknown, status = 200) => ({ status, body: data }),
  error: (message: string, status = 400) => ({ status, body: { error: message } }),
  handleError: (err: unknown) => {
    throw err;
  },
}));

vi.mock("@/lib/supabase", () => {
  function makeBuilder(table: string) {
    const rows = () =>
      table === "income_projections" ? state.projections : state.invoices;
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
      is: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
      not: (c: string, op: string, v: unknown) =>
        (filters.push((r) => !(r[c] === (v === "null" ? null : v))), builder),
      // Parse the exact or-string the route builds: open statuses, or PAID
      // within the cutoff window.
      or: (expr: string) => {
        const statuses = /status\.in\.\(([^)]*)\)/.exec(expr)?.[1].split(",") ?? [];
        const cutoff = /fully_paid_on_date\.gte\.([\d-]+)/.exec(expr)?.[1];
        filters.push(
          (r) =>
            statuses.includes(r.status as string) ||
            (r.status === "PAID" &&
              typeof r.fully_paid_on_date === "string" &&
              cutoff !== undefined &&
              (r.fully_paid_on_date as string) >= cutoff)
        );
        return builder;
      },
      order: () => builder,
      then: (onF: (r: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve({
          data: rows().filter((r) => filters.every((f) => f(r))),
          error: null,
        }).then(onF, onR),
    };
    return builder;
  }
  return { supabase: { from: (table: string) => makeBuilder(table) } };
});

import { GET } from "./route";

type Result = { status: number; body: Record<string, unknown> };
type Pipeline = {
  currentMonth: string;
  projections: Array<Record<string, unknown>>;
  unreviewed: Array<Record<string, unknown>>;
  contacts: Array<{ contactId: string; name: string | null }>;
};

async function run(): Promise<Pipeline> {
  const res = (await GET()) as unknown as Result;
  return res.body as Pipeline;
}

function invoice(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `id-${Math.random().toString(36).slice(2, 8)}`,
    connection_id: "conn",
    type: "ACCREC",
    xero_id: `x-${Math.random().toString(36).slice(2, 8)}`,
    projection_id: null,
    reviewed_at: null,
    contact_id: null,
    contact_name: null,
    status: "AUTHORISED",
    total: 0,
    amount_due: 0,
    issue_date: null,
    due_date: null,
    expected_payment_date: null,
    fully_paid_on_date: null,
    xero_updated_at: null,
    ...overrides,
  };
}

// Pinned clock: 15 June 2026 → currentMonth 2026-06, paid window from 16 May.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
  state.projections = [];
  state.invoices = [];
});

afterEach(() => vi.useRealTimers());

describe("GET /api/pipeline", () => {
  it("tray filter: open ACCREC and recently PAID in; DRAFT, ACCPAY, old PAID, VOIDED out", async () => {
    state.invoices = [
      invoice({ xero_id: "open", status: "AUTHORISED" }),
      invoice({ xero_id: "submitted", status: "SUBMITTED" }),
      invoice({ xero_id: "paid-recent", status: "PAID", fully_paid_on_date: "2026-06-01" }),
      invoice({ xero_id: "paid-old", status: "PAID", fully_paid_on_date: "2026-04-01" }),
      invoice({ xero_id: "draft", status: "DRAFT" }),
      invoice({ xero_id: "voided", status: "VOIDED" }),
      invoice({ xero_id: "bill", status: "AUTHORISED", type: "ACCPAY" }),
      invoice({ xero_id: "reviewed", status: "AUTHORISED", reviewed_at: "2026-06-01T00:00:00Z" }),
    ];
    const res = await run();
    expect(res.unreviewed.map((i) => i.xeroId).sort()).toEqual([
      "open",
      "paid-recent",
      "submitted",
    ]);
  });

  it("remainder excludes VOIDED invoices and floors at zero (R14)", async () => {
    state.projections = [
      {
        id: "p1",
        connection_id: "conn",
        client_label: "IKEA",
        contact_id: "c1",
        amount: 45000,
        expected_month: "2026-08",
        created_at: "",
        updated_at: "",
      },
    ];
    state.invoices = [
      invoice({ xero_id: "a", projection_id: "p1", status: "AUTHORISED", total: 20000, reviewed_at: "x" }),
      invoice({ xero_id: "v", projection_id: "p1", status: "VOIDED", total: 90000, reviewed_at: "x" }),
    ];
    const res = await run();
    expect(res.projections[0].remainder).toBe(25000);
    expect(res.projections[0].invoiceIds).toEqual(["a", "v"]);
  });

  it("lapsed: month before current with remainder > 0; not when equal or consumed (R18)", async () => {
    const base = { connection_id: "conn", client_label: "X", contact_id: null, created_at: "", updated_at: "" };
    state.projections = [
      { ...base, id: "past-open", amount: 1000, expected_month: "2026-05" },
      { ...base, id: "current", amount: 1000, expected_month: "2026-06" },
      { ...base, id: "past-consumed", amount: 1000, expected_month: "2026-05" },
    ];
    state.invoices = [
      invoice({ xero_id: "eats", projection_id: "past-consumed", status: "PAID", total: 1000, reviewed_at: "x" }),
    ];
    const res = await run();
    const byId = Object.fromEntries(res.projections.map((p) => [p.id, p]));
    expect(byId["past-open"].lapsed).toBe(true);
    expect(byId["current"].lapsed).toBe(false);
    expect(byId["past-consumed"].lapsed).toBe(false);
    expect(byId["past-consumed"].remainder).toBe(0);
  });

  it("client keys: contact wins, then normalised label, else UNASSIGNED (R15)", async () => {
    const base = { connection_id: "conn", amount: 100, expected_month: "2026-07", created_at: "", updated_at: "" };
    state.projections = [
      { ...base, id: "a", client_label: "IKEA", contact_id: "c1" },
      { ...base, id: "b", client_label: "  Acme   Co ", contact_id: null },
      { ...base, id: "c", client_label: "", contact_id: null },
    ];
    const res = await run();
    const keys = res.projections.map((p) => p.clientKey);
    expect(keys).toEqual(["contact:c1", "label:acme co", "UNASSIGNED"]);
  });

  it("contacts: distinct per id, name from the most recently synced invoice", async () => {
    state.invoices = [
      invoice({ contact_id: "c1", contact_name: "IKEA Ltd (new)", xero_updated_at: "2026-06-01", reviewed_at: "x" }),
      invoice({ contact_id: "c1", contact_name: "IKEA", xero_updated_at: "2026-01-01", reviewed_at: "x" }),
      invoice({ contact_id: "c2", contact_name: "Acme", xero_updated_at: "2026-03-01", reviewed_at: "x" }),
    ];
    const res = await run();
    expect(res.contacts).toEqual([
      { contactId: "c1", name: "IKEA Ltd (new)" },
      { contactId: "c2", name: "Acme" },
    ]);
  });

  it("overdue flag: due date passed and unpaid; recently paid rows are never overdue", async () => {
    state.invoices = [
      invoice({ xero_id: "late", status: "AUTHORISED", due_date: "2026-06-01" }),
      invoice({ xero_id: "future", status: "AUTHORISED", due_date: "2026-07-01" }),
      invoice({ xero_id: "adjusted", status: "AUTHORISED", due_date: "2026-06-01", expected_payment_date: "2026-07-01" }),
      invoice({ xero_id: "paid", status: "PAID", due_date: "2026-06-01", fully_paid_on_date: "2026-06-10" }),
    ];
    const res = await run();
    const byId = Object.fromEntries(res.unreviewed.map((i) => [i.xeroId, i]));
    expect(byId["late"].overdue).toBe(true);
    expect(byId["future"].overdue).toBe(false);
    expect(byId["adjusted"].overdue).toBe(false);
    expect(byId["paid"].overdue).toBe(false);
  });
});
