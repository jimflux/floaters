import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import { z } from "zod/v4";

const updateItemSchema = z.object({
  type: z.enum(["income", "expense"]).optional(),
  description: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  frequency: z.enum(["once", "weekly", "fortnightly", "monthly", "quarterly", "yearly"]).optional(),
  start_date: z.string().date().optional(),
  end_date: z.string().date().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    await requireConnection();
    const { itemId } = await params;

    const body = await request.json();
    const parsed = updateItemSchema.safeParse(body);
    if (!parsed.success) return error("Invalid input", 400);

    const { data, error: dbError } = await supabase
      .from("scenario_items")
      .update(parsed.data)
      .eq("id", itemId)
      .select()
      .single();

    if (dbError || !data) return error("Item not found", 404);
    return json(data);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    await requireConnection();
    const { itemId } = await params;

    await supabase.from("scenario_items").delete().eq("id", itemId);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
