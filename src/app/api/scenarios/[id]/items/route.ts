import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import { z } from "zod/v4";

const createItemSchema = z.object({
  type: z.enum(["income", "expense"]),
  description: z.string().min(1),
  amount: z.number().positive(),
  frequency: z.enum(["once", "weekly", "fortnightly", "monthly", "quarterly", "yearly"]),
  start_date: z.string().date(),
  end_date: z.string().date().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const connectionId = await requireConnection();
    const { id } = await params;

    // Verify scenario belongs to this connection
    const { data: scenario } = await supabase
      .from("scenarios")
      .select("id")
      .eq("id", id)
      .eq("connection_id", connectionId)
      .single();

    if (!scenario) return error("Scenario not found", 404);

    const body = await request.json();
    const parsed = createItemSchema.safeParse(body);
    if (!parsed.success) {
      return error("Invalid input", 400);
    }

    const { data, error: dbError } = await supabase
      .from("scenario_items")
      .insert({
        scenario_id: id,
        ...parsed.data,
        end_date: parsed.data.end_date || null,
      })
      .select()
      .single();

    if (dbError) return error(dbError.message, 500);
    return json(data, 201);
  } catch (err) {
    return handleError(err);
  }
}
