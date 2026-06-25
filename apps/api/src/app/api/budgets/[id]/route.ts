import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import { z } from "zod/v4";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  period_type: z.enum(["monthly", "weekly"]).optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const connectionId = await requireConnection();
    const { id } = await params;

    const { data } = await supabase
      .from("budgets")
      .select("*, budget_lines(*)")
      .eq("id", id)
      .eq("connection_id", connectionId)
      .single();

    if (!data) return error("Budget not found", 404);
    return json(data);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const connectionId = await requireConnection();
    const { id } = await params;
    const body = await request.json();

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return error("Invalid input", 400);

    const { data, error: dbError } = await supabase
      .from("budgets")
      .update(parsed.data)
      .eq("id", id)
      .eq("connection_id", connectionId)
      .select()
      .single();

    if (dbError || !data) return error("Budget not found", 404);
    return json(data);
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

    await supabase
      .from("budgets")
      .delete()
      .eq("id", id)
      .eq("connection_id", connectionId);

    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
