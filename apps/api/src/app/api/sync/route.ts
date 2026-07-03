import { requireConnection, json, handleError } from "@/lib/api-helpers";
import { runSync, healInvoiceStatuses } from "@/lib/xero/sync";
import { supabase } from "@/lib/supabase";
import { NextRequest } from "next/server";

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

export async function POST(request: NextRequest) {
  try {
    const connectionId = await requireConnection();

    // Optional flags: { full: true } forces a full re-sync, { heal: true }
    // re-fetches locally-open invoices by ID to pick up PAID/VOIDED/DELETED
    // transitions that predate incremental status syncing.
    let flags: { full?: boolean; heal?: boolean } = {};
    try {
      flags = await request.json();
    } catch {
      // No body — routine sync
    }

    const { data: conn } = await supabase
      .from("xero_connections")
      .select("last_synced_at")
      .eq("id", connectionId)
      .single();

    // Sync Now used to force a full sync every time; incremental when we have
    // a last-sync marker keeps it cheap and picks up status transitions.
    const isInitial = flags.full === true || !conn?.last_synced_at;

    let healed = 0;
    if (flags.heal === true) {
      healed = await healInvoiceStatuses(connectionId);
    }

    const records = await runSync(connectionId, isInitial);
    return json({ ok: true, recordsSynced: records, healed });
  } catch (err) {
    return handleError(err);
  }
}
