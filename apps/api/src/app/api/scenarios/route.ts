import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import { z } from "zod/v4";

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

export async function GET() {
  try {
    const connectionId = await requireConnection();

    const { data } = await supabase
      .from("scenarios")
      .select("*, scenario_items(*)")
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
    if (!parsed.success) {
      return error("name is required", 400);
    }

    const { data, error: dbError } = await supabase
      .from("scenarios")
      .insert({
        connection_id: connectionId,
        name: parsed.data.name,
        description: parsed.data.description || null,
      })
      .select()
      .single();

    if (dbError) {
      return error(dbError.message, 500);
    }

    return json(data, 201);
  } catch (err) {
    return handleError(err);
  }
}
