import { supabase } from "@/lib/supabase";
import { xeroRequest, xeroRequestPaginated } from "./client";
import type { XeroInvoice, XeroBankTransaction, XeroAccount } from "@/types/xero";
import { subMonths, formatISO } from "date-fns";

export async function runSync(connectionId: string, isInitial = false) {
  // Mark sync as in progress
  await supabase
    .from("xero_connections")
    .update({ sync_status: "syncing", sync_error: null })
    .eq("id", connectionId);

  const logEntry: {
    connection_id: string;
    status: "success" | "error";
    records_synced: number;
  } = {
    connection_id: connectionId,
    status: "success",
    records_synced: 0,
  };

  try {
    let totalRecords = 0;

    // 1. Sync accounts
    totalRecords += await syncAccounts(connectionId);

    // 2. Sync invoices (AR + AP)
    const { data: conn } = await supabase
      .from("xero_connections")
      .select("last_synced_at")
      .eq("id", connectionId)
      .single();

    const modifiedSince =
      !isInitial && conn?.last_synced_at
        ? conn.last_synced_at
        : undefined;

    totalRecords += await syncInvoices(connectionId, modifiedSince);

    // 3. Sync bank transactions (last 12 months for initial, since last sync otherwise)
    const bankSince = isInitial
      ? formatISO(subMonths(new Date(), 12), { representation: "date" })
      : modifiedSince
        ? formatISO(new Date(modifiedSince), { representation: "date" })
        : formatISO(subMonths(new Date(), 12), { representation: "date" });

    totalRecords += await syncBankTransactions(connectionId, bankSince);

    // Update connection
    await supabase
      .from("xero_connections")
      .update({
        sync_status: "idle",
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId);

    logEntry.records_synced = totalRecords;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";

    await supabase
      .from("xero_connections")
      .update({
        sync_status: "error",
        sync_error: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId);

    logEntry.status = "error";
    await supabase.from("sync_log").insert({
      ...logEntry,
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    });

    throw err;
  }

  await supabase.from("sync_log").insert({
    ...logEntry,
    completed_at: new Date().toISOString(),
  });

  return logEntry.records_synced;
}

async function syncAccounts(connectionId: string): Promise<number> {
  const response = await xeroRequest<{ Accounts: XeroAccount[] }>({
    connectionId,
    endpoint: "Accounts",
  });

  const accounts = response.Accounts || [];

  for (const account of accounts) {
    await supabase.from("xero_accounts").upsert(
      {
        connection_id: connectionId,
        xero_id: account.AccountID,
        code: account.Code,
        name: account.Name,
        type: account.Type,
        class: account.Class,
        status: account.Status,
        bank_account_type: account.BankAccountType || null,
      },
      { onConflict: "connection_id,xero_id" }
    );
  }

  // Fetch bank account balances separately
  try {
    const balanceResponse = await xeroRequest<{
      Reports: Array<{
        Rows: Array<{
          RowType: string;
          Cells?: Array<{ Value: string }>;
          Rows?: Array<{ Cells: Array<{ Value: string; Attributes?: Array<{ Value: string }> }> }>;
        }>;
      }>;
    }>({
      connectionId,
      endpoint: "Reports/BankSummary",
    });

    const report = balanceResponse.Reports?.[0];
    if (report?.Rows) {
      for (const section of report.Rows) {
        if (section.RowType === "Section" && section.Rows) {
          for (const row of section.Rows) {
            const accountIdAttr = row.Cells?.[0]?.Attributes?.find(
              (a) => a.Value
            );
            if (accountIdAttr) {
              const balance = parseFloat(row.Cells?.[1]?.Value || "0");
              await supabase
                .from("xero_accounts")
                .update({ current_balance: balance })
                .eq("connection_id", connectionId)
                .eq("xero_id", accountIdAttr.Value);
            }
          }
        }
      }
    }
  } catch {
    // Bank summary report may not be available for all orgs, non-fatal
  }

  return accounts.length;
}

async function syncInvoices(
  connectionId: string,
  modifiedSince?: string
): Promise<number> {
  const params: Record<string, string> = {
    where: 'Status!="PAID"&&Status!="VOIDED"&&Status!="DELETED"',
  };

  if (modifiedSince) {
    const d = new Date(modifiedSince);
    params.where += `&&UpdatedDateUTC>=DateTime(${d.getFullYear()},${d.getMonth() + 1},${d.getDate()})`;
  }

  const invoices = await xeroRequestPaginated<XeroInvoice>(
    connectionId,
    "Invoices",
    "Invoices",
    params
  );

  for (const inv of invoices) {
    await supabase.from("xero_invoices").upsert(
      {
        connection_id: connectionId,
        xero_id: inv.InvoiceID,
        type: inv.Type,
        contact_name: inv.Contact?.Name || null,
        contact_id: inv.Contact?.ContactID || null,
        status: inv.Status,
        currency_code: inv.CurrencyCode || "GBP",
        total: inv.Total,
        amount_due: inv.AmountDue,
        amount_paid: inv.AmountPaid || 0,
        issue_date: inv.Date,
        due_date: inv.DueDate,
        fully_paid_on_date: inv.FullyPaidOnDate || null,
        line_items: inv.LineItems || null,
        xero_updated_at: inv.UpdatedDateUTC,
      },
      { onConflict: "connection_id,xero_id" }
    );
  }

  return invoices.length;
}

async function syncBankTransactions(
  connectionId: string,
  since: string
): Promise<number> {
  const d = new Date(since);
  const params: Record<string, string> = {
    where: `Date>=DateTime(${d.getFullYear()},${d.getMonth() + 1},${d.getDate()})`,
  };

  const transactions = await xeroRequestPaginated<XeroBankTransaction>(
    connectionId,
    "BankTransactions",
    "BankTransactions",
    params
  );

  for (const txn of transactions) {
    await supabase.from("xero_bank_transactions").upsert(
      {
        connection_id: connectionId,
        xero_id: txn.BankTransactionID,
        type: txn.Type,
        contact_name: txn.Contact?.Name || null,
        account_code: txn.BankAccount?.Code || null,
        account_name: txn.BankAccount?.Name || null,
        total: txn.Total,
        date: txn.Date,
        status: txn.Status,
        is_reconciled: txn.IsReconciled,
        xero_updated_at: txn.UpdatedDateUTC,
      },
      { onConflict: "connection_id,xero_id" }
    );
  }

  return transactions.length;
}
