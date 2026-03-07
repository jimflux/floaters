import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import { z } from "zod/v4";

const createSchema = z.object({
  name: z.string().min(1),
  accountCodes: z.array(z.string().min(1)),
  color: z.string().optional(),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  accountCodes: z.array(z.string().min(1)).optional(),
  color: z.string().nullable().optional(),
});

export async function GET() {
  try {
    const connectionId = await requireConnection();

    const { data } = await supabase
      .from("account_groups")
      .select("id, name, account_codes, color, created_at")
      .eq("connection_id", connectionId)
      .order("created_at", { ascending: true });

    return json({
      groups: (data || []).map((g) => ({
        id: g.id,
        name: g.name,
        accountCodes: g.account_codes,
        color: g.color,
        createdAt: g.created_at,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const body = await request.json();

    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return error("name and accountCodes are required", 400);

    const { data, error: dbError } = await supabase
      .from("account_groups")
      .insert({
        connection_id: connectionId,
        name: parsed.data.name,
        account_codes: parsed.data.accountCodes,
        color: parsed.data.color || null,
      })
      .select()
      .single();

    if (dbError) return error(dbError.message, 500);
    return json(data, 201);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const body = await request.json();

    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return error("id is required", 400);

    const updates: Record<string, unknown> = {};
    if (parsed.data.name) updates.name = parsed.data.name;
    if (parsed.data.accountCodes) updates.account_codes = parsed.data.accountCodes;
    if (parsed.data.color !== undefined) updates.color = parsed.data.color;

    const { data, error: dbError } = await supabase
      .from("account_groups")
      .update(updates)
      .eq("id", parsed.data.id)
      .eq("connection_id", connectionId)
      .select()
      .single();

    if (dbError || !data) return error("Account group not found", 404);
    return json(data);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) return error("id query param required", 400);

    await supabase
      .from("account_groups")
      .delete()
      .eq("id", id)
      .eq("connection_id", connectionId);

    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
