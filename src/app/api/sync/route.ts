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

    // Debug: test Xero API directly before running full sync
    const { getValidAccessToken } = await import("@/lib/xero/auth");
    const { accessToken, tenantId } = await getValidAccessToken(connectionId);

    // Test invoices endpoint directly
    const invoiceUrl = new URL("https://api.xero.com/api.xro/2.0/Invoices");
    invoiceUrl.searchParams.set("where", 'Status!="PAID"&&Status!="VOIDED"&&Status!="DELETED"');
    invoiceUrl.searchParams.set("page", "1");

    const invoiceRes = await fetch(invoiceUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-Tenant-Id": tenantId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const invoiceBody = await invoiceRes.json();
    const invoiceCount = invoiceBody.Invoices?.length ?? "missing key";

    // Test bank transactions endpoint directly
    const bankUrl = new URL("https://api.xero.com/api.xro/2.0/BankTransactions");
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    bankUrl.searchParams.set("where", `Date>=DateTime(${d.getFullYear()},${d.getMonth() + 1},${d.getDate()})`);
    bankUrl.searchParams.set("page", "1");

    const bankRes = await fetch(bankUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-Tenant-Id": tenantId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });

    const bankBody = await bankRes.json();
    const bankCount = bankBody.BankTransactions?.length ?? "missing key";

    // Now run full sync
    const records = await runSync(connectionId, true);

    // Check what ended up in the DB
    const { count: dbInvoices } = await supabase
      .from("xero_invoices")
      .select("*", { count: "exact", head: true })
      .eq("connection_id", connectionId);

    const { count: dbBankTxns } = await supabase
      .from("xero_bank_transactions")
      .select("*", { count: "exact", head: true })
      .eq("connection_id", connectionId);

    return json({
      ok: true,
      recordsSynced: records,
      debug: {
        xeroInvoiceApiStatus: invoiceRes.status,
        xeroInvoiceCount: invoiceCount,
        xeroInvoiceError: invoiceRes.ok ? null : JSON.stringify(invoiceBody).slice(0, 500),
        xeroBankApiStatus: bankRes.status,
        xeroBankCount: bankCount,
        xeroBankError: bankRes.ok ? null : JSON.stringify(bankBody).slice(0, 500),
        dbInvoicesAfterSync: dbInvoices,
        dbBankTxnsAfterSync: dbBankTxns,
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
