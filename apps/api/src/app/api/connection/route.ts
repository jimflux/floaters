import { supabase } from "@/lib/supabase";
import { requireConnection, json, handleError } from "@/lib/api-helpers";
import type { ConnectionResponse } from "@/types/api";

export async function GET() {
  try {
    const connectionId = await requireConnection();

    const { data: conn } = await supabase
      .from("xero_connections")
      .select("tenant_name")
      .eq("id", connectionId)
      .single();

    const { data: accounts } = await supabase
      .from("xero_accounts")
      .select("id, name, code, current_balance, type")
      .eq("connection_id", connectionId)
      .eq("type", "BANK");

    const bankAccounts = (accounts || []).map((a) => ({
      id: a.id,
      name: a.name,
      code: a.code || "",
      balance: Number(a.current_balance) || 0,
    }));

    const totalBalance = bankAccounts.reduce((sum, a) => sum + a.balance, 0);

    const response: ConnectionResponse = {
      connected: true,
      tenantName: conn?.tenant_name || null,
      bankAccounts,
      totalBalance: Math.round(totalBalance * 100) / 100,
    };

    return json(response);
  } catch (err) {
    return handleError(err);
  }
}
