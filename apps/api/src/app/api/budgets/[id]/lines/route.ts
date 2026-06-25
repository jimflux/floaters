import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import { z } from "zod/v4";

const createLineSchema = z.object({
  category: z.string().min(1),
  type: z.enum(["income", "expense"]),
  amount: z.number().positive(),
  period_start: z.string().date(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const connectionId = await requireConnection();
    const { id } = await params;

    // Verify budget belongs to this connection
    const { data: budget } = await supabase
      .from("budgets")
      .select("id")
      .eq("id", id)
      .eq("connection_id", connectionId)
      .single();

    if (!budget) return error("Budget not found", 404);

    const body = await request.json();
    const parsed = createLineSchema.safeParse(body);
    if (!parsed.success) return error("Invalid input", 400);

    const { data, error: dbError } = await supabase
      .from("budget_lines")
      .insert({ budget_id: id, ...parsed.data })
      .select()
      .single();

    if (dbError) return error(dbError.message, 500);
    return json(data, 201);
  } catch (err) {
    return handleError(err);
  }
}
