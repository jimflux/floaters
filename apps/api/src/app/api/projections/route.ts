import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { projectionToApi, type ProjectionRow } from "@/lib/pipeline";
import { NextRequest } from "next/server";
import { z } from "zod/v4";

const createSchema = z.object({
  clientLabel: z.string().min(1),
  // VAT-inclusive; a zero or negative projection is meaningless
  amount: z.number().positive(),
  expectedMonth: z.string().regex(/^\d{4}-\d{2}$/),
  contactId: z.string().min(1).nullable().optional(),
});

export async function GET() {
  try {
    const connectionId = await requireConnection();

    const { data } = await supabase
      .from("income_projections")
      .select("*")
      .eq("connection_id", connectionId)
      .order("expected_month", { ascending: true });

    return json({ projections: ((data as ProjectionRow[]) || []).map(projectionToApi) });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const body = await request.json();

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return error(
        "clientLabel, amount (> 0, inc VAT) and expectedMonth (yyyy-MM) are required",
        400
      );
    }

    const { data, error: dbError } = await supabase
      .from("income_projections")
      .insert({
        connection_id: connectionId,
        client_label: parsed.data.clientLabel,
        contact_id: parsed.data.contactId ?? null,
        amount: parsed.data.amount,
        expected_month: parsed.data.expectedMonth,
      })
      .select()
      .single();

    if (dbError) return error(dbError.message, 500);
    return json(projectionToApi(data as ProjectionRow), 201);
  } catch (err) {
    return handleError(err);
  }
}
