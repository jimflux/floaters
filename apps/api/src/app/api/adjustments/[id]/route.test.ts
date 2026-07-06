import { describe, it, expect, beforeEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  invoices: [] as Record<string, unknown>[],
  projections: [] as Record<string, unknown>[],
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
    const rows =
      table === "xero_invoices" ? state.invoices : state.projections;
    const filters: Record<string, unknown> = {};
    let op: "select" | "update" = "select";
    let payload: Record<string, unknown> | null = null;

    const matches = (r: Record<string, unknown>) =>
      Object.entries(filters).every(([k, v]) => r[k] === v);

    function resolve() {
      const hit = rows.filter((r) => matches(r as Record<string, unknown>));
      if (op === "update") hit.forEach((r) => Object.assign(r, payload));
      return hit;
    }

    const builder: Record<string, unknown> = {
      select: () => builder,
      update: (p: Record<string, unknown>) => ((op = "update"), (payload = p), builder),
      eq: (c: string, v: unknown) => ((filters[c] = v), builder),
      single: () => {
        const hit = resolve();
        return Promise.resolve(
          hit.length
            ? { data: hit[0], error: null }
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

import { PATCH } from "./route";

type Result = { status: number; body: Record<string, unknown> };

const patchReq = (body: unknown) =>
  ({ json: async () => body }) as Parameters<typeof PATCH>[0];
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

async function patch(id: string, body: unknown): Promise<Result> {
  return (await PATCH(patchReq(body), idParams(id))) as unknown as Result;
}

beforeEach(() => {
  state.invoices = [
    {
      id: "inv-1",
      connection_id: "conn",
      type: "ACCREC",
      contact_id: "c-ikea",
      projection_id: null,
      reviewed_at: null,
    },
    {
      id: "bill-1",
      connection_id: "conn",
      type: "ACCPAY",
      contact_id: "c-supplier",
      projection_id: null,
      reviewed_at: null,
    },
  ];
  state.projections = [
    { id: "11111111-1111-4111-8111-111111111111", connection_id: "conn", contact_id: null },
    { id: "22222222-2222-4222-8222-222222222222", connection_id: "conn", contact_id: "c-other" },
    { id: "33333333-3333-4333-8333-333333333333", connection_id: "other", contact_id: null },
  ];
});

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const FOREIGN = "33333333-3333-4333-8333-333333333333";

describe("adjustments PATCH: review and assignment", () => {
  it("assign sets projection_id, stamps reviewed_at, and backfills the projection's contact", async () => {
    const res = await patch("inv-1", { projectionId: P1 });
    expect(res.status).toBe(200);
    const inv = state.invoices[0];
    expect(inv.projection_id).toBe(P1);
    expect(inv.reviewed_at).toBeTruthy();
    // Contact-less projection adopted the invoice's contact (R15).
    expect(state.projections[0].contact_id).toBe("c-ikea");
  });

  it("does not overwrite a projection's existing contact on assignment", async () => {
    await patch("inv-1", { projectionId: P2 });
    expect(state.projections[1].contact_id).toBe("c-other");
  });

  it("reassign updates the link; unassign nulls it and keeps reviewed_at", async () => {
    await patch("inv-1", { projectionId: P1 });
    await patch("inv-1", { projectionId: P2 });
    expect(state.invoices[0].projection_id).toBe(P2);

    const stamped = state.invoices[0].reviewed_at;
    const res = await patch("inv-1", { projectionId: null });
    expect(res.status).toBe(200);
    expect(state.invoices[0].projection_id).toBeNull();
    expect(state.invoices[0].reviewed_at).toBe(stamped);
  });

  it("assigning to a projection from another connection: 404, no write", async () => {
    const res = await patch("inv-1", { projectionId: FOREIGN });
    expect(res.status).toBe(404);
    expect(state.invoices[0].projection_id).toBeNull();
    expect(state.invoices[0].reviewed_at).toBeNull();
  });

  it("assigning an ACCPAY invoice: 400, no write", async () => {
    const res = await patch("bill-1", { projectionId: P1 });
    expect(res.status).toBe(400);
    expect(state.invoices[1].projection_id).toBeNull();
  });

  it("reviewed: true stamps reviewed_at without a projection (standalone approve)", async () => {
    const res = await patch("inv-1", { reviewed: true });
    expect(res.status).toBe(200);
    expect(state.invoices[0].reviewed_at).toBeTruthy();
    expect(state.invoices[0].projection_id).toBeNull();
  });

  it("assignment wins over reviewed: false in the same request", async () => {
    await patch("inv-1", { projectionId: P1, reviewed: false });
    expect(state.invoices[0].reviewed_at).toBeTruthy();
  });

  it("still adjusts expected_payment_date (existing behaviour)", async () => {
    const res = await patch("inv-1", { expected_payment_date: "2026-08-15" });
    expect(res.status).toBe(200);
    expect(state.invoices[0].expected_payment_date).toBe("2026-08-15");
  });

  it("empty body: 400", async () => {
    const res = await patch("inv-1", {});
    expect(res.status).toBe(400);
  });
});
