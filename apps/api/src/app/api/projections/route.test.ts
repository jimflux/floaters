import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  projections: [] as Record<string, unknown>[],
  invoices: [] as Record<string, unknown>[],
  nextId: 1,
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
  function rowsFor(table: string) {
    return table === "income_projections" ? state.projections : state.invoices;
  }
  function makeBuilder(table: string) {
    const filters: Record<string, unknown> = {};
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Record<string, unknown> | null = null;

    const matches = (r: Record<string, unknown>) =>
      Object.entries(filters).every(([k, v]) => r[k] === v);

    function resolve() {
      const rows = rowsFor(table);
      if (op === "insert") {
        const row = {
          id: `p${state.nextId++}`,
          created_at: "2026-07-06T00:00:00Z",
          updated_at: "2026-07-06T00:00:00Z",
          ...payload,
        };
        rows.push(row);
        return [row];
      }
      if (op === "update") {
        const hit = rows.filter((r) => matches(r as Record<string, unknown>));
        hit.forEach((r) => Object.assign(r, payload));
        return hit;
      }
      if (op === "delete") {
        const hit = rows.filter((r) => matches(r as Record<string, unknown>));
        // Mirror the FK: on delete set null on xero_invoices.projection_id.
        if (table === "income_projections") {
          for (const p of hit) {
            state.invoices
              .filter((inv) => inv.projection_id === (p as { id: string }).id)
              .forEach((inv) => (inv.projection_id = null));
          }
        }
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        return hit;
      }
      return rows.filter((r) => matches(r as Record<string, unknown>));
    }

    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (p: Record<string, unknown>) => ((op = "insert"), (payload = p), builder),
      update: (p: Record<string, unknown>) => ((op = "update"), (payload = p), builder),
      delete: () => ((op = "delete"), builder),
      eq: (c: string, v: unknown) => ((filters[c] = v), builder),
      order: () => builder,
      single: () => {
        const rows = resolve();
        return Promise.resolve(
          rows.length
            ? { data: rows[0], error: null }
            : { data: null, error: { message: "not found" } }
        );
      },
      then: (onF: (r: unknown) => unknown, onR?: (e: unknown) => unknown) =>
        Promise.resolve({ data: resolve(), error: null }).then(onF, onR),
    };
    return builder;
  }
  return { supabase: { from: (table: string) => makeBuilder(table) } };
});

import { GET, POST } from "./route";
import { PATCH, DELETE } from "./[id]/route";

type Result = { status: number; body: Record<string, unknown> };

const postReq = (body: unknown) =>
  ({ json: async () => body }) as Parameters<typeof POST>[0];
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.projections = [];
  state.invoices = [];
  state.nextId = 1;
});

describe("projections CRUD", () => {
  it("creates and lists a projection with camelCase fields", async () => {
    const created = (await POST(
      postReq({ clientLabel: "IKEA", amount: 45500, expectedMonth: "2026-08" })
    )) as unknown as Result;
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      clientLabel: "IKEA",
      contactId: null,
      amount: 45500,
      expectedMonth: "2026-08",
    });

    const listed = (await GET()) as unknown as Result;
    const list = listed.body as { projections: Record<string, unknown>[] };
    expect(list.projections).toHaveLength(1);
    expect(list.projections[0].id).toBe(created.body.id);
  });

  it("rejects a malformed month and a non-positive amount", async () => {
    const badMonth = (await POST(
      postReq({ clientLabel: "X", amount: 100, expectedMonth: "August" })
    )) as unknown as Result;
    expect(badMonth.status).toBe(400);
    expect(String((badMonth.body as { error: string }).error)).toMatch(/yyyy-MM/);

    const badAmount = (await POST(
      postReq({ clientLabel: "X", amount: -5, expectedMonth: "2026-08" })
    )) as unknown as Result;
    expect(badAmount.status).toBe(400);
  });

  it("PATCH re-dates to a past month (lapse is read-time; API allows)", async () => {
    const created = (await POST(
      postReq({ clientLabel: "Edifai", amount: 21000, expectedMonth: "2026-07" })
    )) as unknown as Result;

    const patched = (await PATCH(
      postReq({ expectedMonth: "2026-01" }) as Parameters<typeof PATCH>[0],
      idParams(created.body.id as string)
    )) as unknown as Result;
    expect(patched.status).toBe(200);
    expect((patched.body as { expectedMonth: string }).expectedMonth).toBe("2026-01");
  });

  it("PATCH on an unknown id returns 404", async () => {
    const res = (await PATCH(
      postReq({ amount: 10 }) as Parameters<typeof PATCH>[0],
      idParams("nope")
    )) as unknown as Result;
    expect(res.status).toBe(404);
  });

  it("delete releases assigned invoices (projection_id nulled, reviewed_at untouched)", async () => {
    const created = (await POST(
      postReq({ clientLabel: "IKEA", amount: 45500, expectedMonth: "2026-08" })
    )) as unknown as Result;
    const pid = created.body.id as string;
    state.invoices = [
      { xero_id: "inv-1", projection_id: pid, reviewed_at: "2026-07-01T00:00:00Z" },
    ];

    const res = (await DELETE(
      postReq(null) as Parameters<typeof DELETE>[0],
      idParams(pid)
    )) as unknown as Result;
    expect((res.body as { ok: boolean }).ok).toBe(true);
    expect(state.projections).toHaveLength(0);
    expect(state.invoices[0].projection_id).toBeNull();
    expect(state.invoices[0].reviewed_at).toBe("2026-07-01T00:00:00Z");
  });
});
