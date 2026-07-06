import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import { z } from "zod/v4";

// One surface for locally-owned invoice fields: payment-date adjustments and
// pipeline review/assignment (all survive sync upserts).
const updateSchema = z
  .object({
    expected_payment_date: z.string().date().optional(),
    projectionId: z.uuid().nullable().optional(),
    reviewed: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "empty" });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const connectionId = await requireConnection();
    const { id } = await params;

    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return error(
        "Expected expected_payment_date (YYYY-MM-DD), projectionId (uuid or null) or reviewed (boolean).",
        400
      );
    }

    const { data: invoice } = await supabase
      .from("xero_invoices")
      .select("id, type, contact_id, reviewed_at")
      .eq("id", id)
      .eq("connection_id", connectionId)
      .single();
    if (!invoice) return error("Invoice not found", 404);

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (parsed.data.expected_payment_date !== undefined) {
      patch.expected_payment_date = parsed.data.expected_payment_date;
    }

    if (parsed.data.reviewed !== undefined) {
      patch.reviewed_at = parsed.data.reviewed ? new Date().toISOString() : null;
    }

    // After `reviewed` so assignment-implies-review wins over reviewed: false.
    // Deferred: only re-key the projection once the assignment has persisted.
    let contactBackfillId: string | null = null;
    if (parsed.data.projectionId !== undefined) {
      if (parsed.data.projectionId === null) {
        // Unassign releases the link; the invoice stays reviewed.
        patch.projection_id = null;
      } else {
        // Projections are income-only.
        if (invoice.type !== "ACCREC") {
          return error("Only ACCREC invoices can be assigned to a projection", 400);
        }
        const { data: projection } = await supabase
          .from("income_projections")
          .select("id, contact_id")
          .eq("id", parsed.data.projectionId)
          .eq("connection_id", connectionId)
          .single();
        if (!projection) return error("Projection not found", 404);

        patch.projection_id = projection.id;
        // Assignment implies review.
        patch.reviewed_at = new Date().toISOString();

        // R15: a contact-less projection adopts the invoice's contact — but
        // only after the assignment below succeeds, so a failed invoice
        // update can never silently re-key the projection's client rollup.
        if (!projection.contact_id && invoice.contact_id) {
          contactBackfillId = invoice.contact_id as string;
        }
      }
    }

    const { data, error: dbError } = await supabase
      .from("xero_invoices")
      .update(patch)
      .eq("id", id)
      .eq("connection_id", connectionId)
      .select()
      .single();

    if (dbError || !data) {
      return error("Invoice not found", 404);
    }

    if (contactBackfillId && patch.projection_id) {
      await supabase
        .from("income_projections")
        .update({
          contact_id: contactBackfillId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", patch.projection_id as string)
        .eq("connection_id", connectionId);
    }

    return json(data);
  } catch (err) {
    return handleError(err);
  }
}
