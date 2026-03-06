import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import { z } from "zod/v4";

const upsertSchema = z.object({
  minimum_balance: z.number(),
  alert_email: z.boolean().default(true),
});

export async function GET() {
  try {
    const connectionId = await requireConnection();

    const { data } = await supabase
      .from("cash_thresholds")
      .select("*")
      .eq("connection_id", connectionId)
      .limit(1)
      .single();

    if (!data) {
      return json({ id: null, minimumBalance: null, alertEmail: true });
    }

    return json({
      id: data.id,
      minimumBalance: Number(data.minimum_balance),
      alertEmail: data.alert_email,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const body = await request.json();

    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) return error("minimum_balance is required", 400);

    // Delete existing and insert new (single threshold per connection)
    await supabase
      .from("cash_thresholds")
      .delete()
      .eq("connection_id", connectionId);

    const { data, error: dbError } = await supabase
      .from("cash_thresholds")
      .insert({
        connection_id: connectionId,
        minimum_balance: parsed.data.minimum_balance,
        alert_email: parsed.data.alert_email,
      })
      .select()
      .single();

    if (dbError) return error(dbError.message, 500);
    return json(data, 201);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE() {
  try {
    const connectionId = await requireConnection();

    await supabase
      .from("cash_thresholds")
      .delete()
      .eq("connection_id", connectionId);

    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
