import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { supabase } from "@/lib/supabase";
import { NextRequest } from "next/server";
import { z } from "zod/v4";

// Raw VAT store: the dark-launch flag, paid-quarter markers, and per-client
// VATable overrides. Resolution (override, else seed from invoice tax, else
// VATable) happens in the cashflow route where the invoice data lives; this
// route just reads and writes the stored overrides.

export async function GET() {
  try {
    const connectionId = await requireConnection();
    const { data: state } = await supabase
      .from("vat_state")
      .select("enabled, paid_quarters")
      .eq("connection_id", connectionId)
      .maybeSingle();
    const { data: overrides } = await supabase
      .from("vatable_clients")
      .select("client_key, vatable")
      .eq("connection_id", connectionId);
    return json({
      enabled: state?.enabled ?? false,
      paidQuarters: state?.paid_quarters ?? [],
      overrides: (overrides ?? []).map((o) => ({ clientKey: o.client_key, vatable: o.vatable })),
    });
  } catch (err) {
    return handleError(err);
  }
}

const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    clientKey: z.string().min(1).optional(),
    vatable: z.boolean().optional(),
    markPaidQuarter: z.string().optional(),
    unmarkPaidQuarter: z.string().optional(),
  })
  .refine((d) => d.clientKey === undefined || d.vatable !== undefined, {
    message: "vatable is required when clientKey is set",
  });

export async function PATCH(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const body = await request.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body ?? {});
    if (!parsed.success) return error("Invalid VAT settings", 400);
    const d = parsed.data;

    if (d.clientKey !== undefined && d.vatable !== undefined) {
      await supabase.from("vatable_clients").upsert(
        {
          connection_id: connectionId,
          client_key: d.clientKey,
          vatable: d.vatable,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "connection_id,client_key" }
      );
    }

    if (d.enabled !== undefined || d.markPaidQuarter || d.unmarkPaidQuarter) {
      const { data: cur } = await supabase
        .from("vat_state")
        .select("enabled, paid_quarters")
        .eq("connection_id", connectionId)
        .maybeSingle();
      const paid = new Set<string>(cur?.paid_quarters ?? []);
      if (d.markPaidQuarter) paid.add(d.markPaidQuarter);
      if (d.unmarkPaidQuarter) paid.delete(d.unmarkPaidQuarter);
      await supabase.from("vat_state").upsert(
        {
          connection_id: connectionId,
          enabled: d.enabled ?? cur?.enabled ?? false,
          paid_quarters: [...paid],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "connection_id" }
      );
    }

    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
