import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import { z } from "zod/v4";

const updateSchema = z.object({
  expected_payment_date: z.string().date(),
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
      return error("Invalid date format. Use YYYY-MM-DD.", 400);
    }

    const { data, error: dbError } = await supabase
      .from("xero_invoices")
      .update({
        expected_payment_date: parsed.data.expected_payment_date,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("connection_id", connectionId)
      .select()
      .single();

    if (dbError || !data) {
      return error("Invoice not found", 404);
    }

    return json(data);
  } catch (err) {
    return handleError(err);
  }
}
