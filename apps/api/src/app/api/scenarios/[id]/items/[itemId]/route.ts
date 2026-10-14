import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import { z } from "zod/v4";
import { isRetirementScenarioId } from "@/lib/retirement";

const updateItemSchema = z.object({
  type: z.enum(["income", "expense"]).optional(),
  description: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  frequency: z.enum(["once", "weekly", "fortnightly", "monthly", "quarterly", "yearly"]).optional(),
  start_date: z.string().date().optional(),
  end_date: z.string().date().nullable().optional(),
});

async function ownsBusinessScenario(connectionId: string, id: string): Promise<boolean> {
  if (isRetirementScenarioId(connectionId, id)) return false;
  const { data, error: dbError } = await supabase
    .from("scenarios").select("id").eq("id", id).eq("connection_id", connectionId).single();
  return !dbError && !!data;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const connectionId = await requireConnection();
    const { id, itemId } = await params;
    if (!await ownsBusinessScenario(connectionId, id)) return error("Scenario not found", 404);

    const body = await request.json();
    const parsed = updateItemSchema.safeParse(body);
    if (!parsed.success) return error("Invalid input", 400);

    const { data, error: dbError } = await supabase
      .from("scenario_items")
      .update(parsed.data)
      .eq("id", itemId)
      .eq("scenario_id", id)
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
    const connectionId = await requireConnection();
    const { id, itemId } = await params;
    if (!await ownsBusinessScenario(connectionId, id)) return error("Scenario not found", 404);

    const { error: dbError } = await supabase.from("scenario_items").delete().eq("id", itemId).eq("scenario_id", id);
    if (dbError) return error("Could not delete item", 500);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
