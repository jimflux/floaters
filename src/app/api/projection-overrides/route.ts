import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import { z } from "zod/v4";

const upsertSchema = z.object({
  accountCode: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  amount: z.number().min(0),
});

export async function GET() {
  try {
    const connectionId = await requireConnection();

    const { data } = await supabase
      .from("projection_overrides")
      .select("account_code, month, amount")
      .eq("connection_id", connectionId);

    return json({
      overrides: (data || []).map((r) => ({
        accountCode: r.account_code,
        month: r.month,
        amount: Number(r.amount),
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const body = await request.json();

    const parsed = upsertSchema.safeParse(body);
    if (!parsed.success) {
      return error("accountCode, month (yyyy-MM), and amount (>= 0) are required", 400);
    }

    const { error: dbError } = await supabase
      .from("projection_overrides")
      .upsert(
        {
          connection_id: connectionId,
          account_code: parsed.data.accountCode,
          month: parsed.data.month,
          amount: parsed.data.amount,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "connection_id,account_code,month" }
      );

    if (dbError) return error(dbError.message, 500);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  return PUT(request);
}

export async function DELETE(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const { searchParams } = new URL(request.url);
    const accountCode = searchParams.get("accountCode");
    const month = searchParams.get("month");

    if (!accountCode || !month) {
      return error("accountCode and month query params required", 400);
    }

    await supabase
      .from("projection_overrides")
      .delete()
      .eq("connection_id", connectionId)
      .eq("account_code", accountCode)
      .eq("month", month);

    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
