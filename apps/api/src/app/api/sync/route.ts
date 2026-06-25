import { requireConnection, json, handleError } from "@/lib/api-helpers";
import { runSync } from "@/lib/xero/sync";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    const connectionId = await requireConnection();

    // Return sync status + sync log
    const { data: conn } = await supabase
      .from("xero_connections")
      .select("sync_status, sync_error, last_synced_at")
      .eq("id", connectionId)
      .single();

    const { data: logs } = await supabase
      .from("sync_log")
      .select("*")
      .eq("connection_id", connectionId)
      .order("completed_at", { ascending: false })
      .limit(10);

    // Also check table counts
    const { count: invoiceCount } = await supabase
      .from("xero_invoices")
      .select("*", { count: "exact", head: true })
      .eq("connection_id", connectionId);

    const { count: bankTxnCount } = await supabase
      .from("xero_bank_transactions")
      .select("*", { count: "exact", head: true })
      .eq("connection_id", connectionId);

    const { count: accountCount } = await supabase
      .from("xero_accounts")
      .select("*", { count: "exact", head: true })
      .eq("connection_id", connectionId);

    return json({
      connection: conn,
      tableCounts: {
        accounts: accountCount,
        invoices: invoiceCount,
        bankTransactions: bankTxnCount,
      },
      recentLogs: logs,
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST() {
  try {
    const connectionId = await requireConnection();
    const records = await runSync(connectionId, true);
    return json({ ok: true, recordsSynced: records });
  } catch (err) {
    return handleError(err);
  }
}
