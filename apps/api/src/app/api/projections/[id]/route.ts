import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { projectionToApi, type ProjectionRow } from "@/lib/pipeline";
import { NextRequest } from "next/server";
import { z } from "zod/v4";

// Re-dating to a past month is allowed: lapse is a read-time concept and the
// UI owns the warning.
const updateSchema = z.object({
  clientLabel: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  expectedMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  contactId: z.string().min(1).nullable().optional(),
});

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
        "Invalid input: amount must be > 0, expectedMonth yyyy-MM",
        400
      );
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (parsed.data.clientLabel !== undefined) patch.client_label = parsed.data.clientLabel;
    if (parsed.data.amount !== undefined) patch.amount = parsed.data.amount;
    if (parsed.data.expectedMonth !== undefined) patch.expected_month = parsed.data.expectedMonth;
    if (parsed.data.contactId !== undefined) patch.contact_id = parsed.data.contactId;

    const { data, error: dbError } = await supabase
      .from("income_projections")
      .update(patch)
      .eq("id", id)
      .eq("connection_id", connectionId)
      .select()
      .single();

    if (dbError || !data) return error("Projection not found", 404);
    return json(projectionToApi(data as ProjectionRow));
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const connectionId = await requireConnection();
    const { id } = await params;

    // FK on xero_invoices.projection_id is on-delete-set-null: assigned
    // invoices are released to standalone, reviewed_at untouched (R16).
    await supabase
      .from("income_projections")
      .delete()
      .eq("id", id)
      .eq("connection_id", connectionId);

    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
