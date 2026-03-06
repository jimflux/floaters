import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import { z } from "zod/v4";

const createSchema = z.object({
  name: z.string().min(1),
  period_type: z.enum(["monthly", "weekly"]).default("monthly"),
});

export async function GET() {
  try {
    const connectionId = await requireConnection();

    const { data } = await supabase
      .from("budgets")
      .select("*, budget_lines(*)")
      .eq("connection_id", connectionId)
      .order("created_at", { ascending: false });

    return json(data || []);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const body = await request.json();

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return error("name is required", 400);

    const { data, error: dbError } = await supabase
      .from("budgets")
      .insert({
        connection_id: connectionId,
        name: parsed.data.name,
        period_type: parsed.data.period_type,
      })
      .select()
      .single();

    if (dbError) return error(dbError.message, 500);
    return json(data, 201);
  } catch (err) {
    return handleError(err);
  }
}
