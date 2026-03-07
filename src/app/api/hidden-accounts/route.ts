import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";

export async function GET() {
  try {
    const connectionId = await requireConnection();

    const { data } = await supabase
      .from("hidden_accounts")
      .select("account_code")
      .eq("connection_id", connectionId);

    return json({ hiddenAccounts: (data || []).map((r) => r.account_code) });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const body = await request.json();
    const accountCode = body.accountCode;

    if (!accountCode || typeof accountCode !== "string") {
      return error("accountCode is required", 400);
    }

    const { error: dbError } = await supabase
      .from("hidden_accounts")
      .upsert(
        { connection_id: connectionId, account_code: accountCode },
        { onConflict: "connection_id,account_code" }
      );

    if (dbError) return error(dbError.message, 500);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const { searchParams } = new URL(request.url);
    const accountCode = searchParams.get("accountCode");

    if (!accountCode) return error("accountCode query param required", 400);

    await supabase
      .from("hidden_accounts")
      .delete()
      .eq("connection_id", connectionId)
      .eq("account_code", accountCode);

    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
