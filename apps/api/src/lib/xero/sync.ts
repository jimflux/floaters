import { supabase } from "@/lib/supabase";
import { xeroRequest, xeroRequestPaginated } from "./client";
import type { XeroInvoice, XeroBankTransaction, XeroAccount, XeroPayment } from "@/types/xero";
import { subMonths, formatISO } from "date-fns";

// Payments and bank transactions are only synced this far back; the cashflow
// window must not exceed it or reconstructed history goes silently wrong.
export const HISTORY_MONTHS = 12;

// Upsert rows in batches instead of one round-trip per row. A single sync can
// touch hundreds of invoices/transactions; row-at-a-time upserts were the main
// reason a sync felt slow. Chunked to keep individual requests a sane size.
const UPSERT_CHUNK = 500;

export async function chunkedUpsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string
): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) {
      console.error(
        `Upsert into ${table} failed (chunk starting ${i}):`,
        error.message
      );
      throw new Error(`Failed to upsert ${table}: ${error.message}`);
    }
  }
}

/**
 * Parse Xero's date format: "/Date(1234567890000+0000)/" or ISO string
 * Returns ISO date string (yyyy-MM-dd) or null
 */
export function parseXeroDate(value: string | undefined | null): string | null {
  if (!value) return null;
  // Match /Date(milliseconds+offset)/
  const match = value.match(/\/Date\((\d+)([+-]\d{4})?\)\//);
  if (match) {
    const ms = parseInt(match[1], 10);
    const d = new Date(ms);
    return d.toISOString().split("T")[0];
  }
  // Already an ISO string like "2024-01-15T00:00:00"
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().split("T")[0];
}

/**
 * Parse Xero's datetime format to ISO timestamp
 */
export function parseXeroDateTime(value: string | undefined | null): string | null {
  if (!value) return null;
  const match = value.match(/\/Date\((\d+)([+-]\d{4})?\)\//);
  if (match) {
    return new Date(parseInt(match[1], 10)).toISOString();
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Xero where-clause date literal (local calendar day, matching Xero's own behaviour)
export function xeroDateFilter(d: Date): string {
  return `DateTime(${d.getFullYear()},${d.getMonth() + 1},${d.getDate()})`;
}

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

    // 4. Sync invoice payments (the cash side of invoice settlement)
    totalRecords += await syncPayments(connectionId, modifiedSince);

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

  await chunkedUpsert(
    "xero_accounts",
    accounts.map((account) => ({
      connection_id: connectionId,
      xero_id: account.AccountID,
      code: account.Code,
      name: account.Name,
      type: account.Type,
      class: account.Class,
      status: account.Status,
      bank_account_type: account.BankAccountType || null,
    })),
    "connection_id,xero_id"
  );

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
              // BankSummary columns: [Account, Opening, CashReceived, CashSpent, Closing]
              // Read the last cell (closing balance) for the current balance
              const cells = row.Cells || [];
              const closingCell = cells[cells.length - 1];
              const balance = parseFloat(closingCell?.Value || "0");
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

/**
 * Map a Xero invoice payload to an upsert row.
 * Never includes expected_payment_date: that column is locally owned (set via
 * the adjustments route) and must survive re-sync upserts.
 * Returns null when Xero sends unparseable dates.
 */
export function mapInvoice(
  connectionId: string,
  inv: XeroInvoice
): Record<string, unknown> | null {
  const issueDate = parseXeroDate(inv.Date);
  const dueDate = parseXeroDate(inv.DueDate);
  if (!issueDate || !dueDate) return null;
  return {
    connection_id: connectionId,
    xero_id: inv.InvoiceID,
    type: inv.Type,
    contact_name: inv.Contact?.Name || null,
    contact_id: inv.Contact?.ContactID || null,
    status: inv.Status,
    currency_code: inv.CurrencyCode || "GBP",
    total: inv.Total,
    // Real output VAT from Xero. null when absent (older payloads) so an
    // un-synced invoice stays distinguishable from a genuine zero-VAT one.
    total_tax: inv.TotalTax ?? null,
    amount_due: inv.AmountDue,
    amount_paid: inv.AmountPaid || 0,
    issue_date: issueDate,
    due_date: dueDate,
    fully_paid_on_date: parseXeroDate(inv.FullyPaidOnDate),
    line_items: inv.LineItems || null,
    xero_updated_at: parseXeroDateTime(inv.UpdatedDateUTC),
  };
}

/**
 * Build the invoice sync filter.
 * Initial syncs exclude PAID/VOIDED/DELETED to bound volume. Incremental
 * syncs must NOT exclude them: a status transition to PAID/VOIDED/DELETED is
 * exactly the update we need, otherwise the local row stays "unpaid" forever
 * and projects phantom cash.
 */
export function invoiceWhere(modifiedSince?: string): string {
  if (modifiedSince) {
    return `UpdatedDateUTC>=${xeroDateFilter(new Date(modifiedSince))}`;
  }
  return 'Status!="PAID"&&Status!="VOIDED"&&Status!="DELETED"';
}

async function syncInvoices(
  connectionId: string,
  modifiedSince?: string
): Promise<number> {
  const params: Record<string, string> = {
    where: invoiceWhere(modifiedSince),
  };

  const invoices = await xeroRequestPaginated<XeroInvoice>(
    connectionId,
    "Invoices",
    "Invoices",
    params
  );

  const rows: Record<string, unknown>[] = [];
  for (const inv of invoices) {
    const row = mapInvoice(connectionId, inv);
    if (!row) {
      console.warn(`Skipping invoice ${inv.InvoiceID}: invalid dates`, inv.Date, inv.DueDate);
      continue;
    }
    rows.push(row);
  }

  await chunkedUpsert("xero_invoices", rows, "connection_id,xero_id");
  return rows.length;
}

/**
 * Map a Xero payment to an upsert row.
 * Payments without an Invoice link (credit note / overpayment / prepayment
 * payments) return null: cash refunds via credit notes are a known deferral.
 */
export function mapPayment(
  connectionId: string,
  p: XeroPayment
): Record<string, unknown> | null {
  if (!p.Invoice?.InvoiceID) return null;
  const date = parseXeroDate(p.Date);
  if (!date) return null;
  return {
    connection_id: connectionId,
    xero_id: p.PaymentID,
    invoice_xero_id: p.Invoice.InvoiceID,
    payment_type: p.PaymentType || null,
    status: p.Status || null,
    amount: p.Amount,
    date,
    xero_updated_at: parseXeroDateTime(p.UpdatedDateUTC),
  };
}

/**
 * Fetch specific invoices by ID (batched) and upsert them. Fetching by IDs
 * bypasses status filters, so this is how PAID/VOIDED invoices get into the
 * local store: payment attribution and the status heal both rely on it.
 */
export async function fetchInvoicesByIds(
  connectionId: string,
  ids: string[]
): Promise<number> {
  // Keep the IDs param comfortably inside URL limits
  const BATCH = 40;
  let count = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const response = await xeroRequest<{ Invoices: XeroInvoice[] }>({
      connectionId,
      endpoint: "Invoices",
      params: { IDs: batch.join(",") },
    });
    const rows = (response.Invoices || [])
      .map((inv) => mapInvoice(connectionId, inv))
      .filter((r): r is Record<string, unknown> => r !== null);
    await chunkedUpsert("xero_invoices", rows, "connection_id,xero_id");
    count += rows.length;
  }
  return count;
}

export async function syncPayments(
  connectionId: string,
  modifiedSince?: string
): Promise<number> {
  // Existing connections predate the payments table, so the first sync after
  // deploy must backfill history even though it runs incrementally.
  let hasPayments = false;
  if (modifiedSince) {
    const { count } = await supabase
      .from("xero_payments")
      .select("*", { count: "exact", head: true })
      .eq("connection_id", connectionId);
    hasPayments = (count ?? 0) > 0;
  }

  // Initial: bounded to the same window as bank transactions so history depth
  // is consistent. Incremental: everything updated since last sync.
  const params: Record<string, string> = {};
  if (modifiedSince && hasPayments) {
    params.where = `UpdatedDateUTC>=${xeroDateFilter(new Date(modifiedSince))}`;
  } else {
    const d = new Date(formatISO(subMonths(new Date(), HISTORY_MONTHS), { representation: "date" }));
    params.where = `Date>=${xeroDateFilter(d)}`;
  }

  const payments = await xeroRequestPaginated<XeroPayment>(
    connectionId,
    "Payments",
    "Payments",
    params
  );

  const rows: Record<string, unknown>[] = [];
  for (const p of payments) {
    const row = mapPayment(connectionId, p);
    if (row) rows.push(row);
  }

  await chunkedUpsert("xero_payments", rows, "connection_id,xero_id");

  // Payments often reference invoices that were PAID before the first invoice
  // sync ran (that sync excludes PAID), so their line items are missing
  // locally. Backfill them so payment attribution has accounts to point at.
  const invoiceIds = [...new Set(rows.map((r) => r.invoice_xero_id as string))];
  let backfilled = 0;
  if (invoiceIds.length > 0) {
    const { data: existing } = await supabase
      .from("xero_invoices")
      .select("xero_id")
      .eq("connection_id", connectionId)
      .in("xero_id", invoiceIds);
    const known = new Set((existing || []).map((r) => r.xero_id));
    const missing = invoiceIds.filter((id) => !known.has(id));
    if (missing.length > 0) {
      backfilled = await fetchInvoicesByIds(connectionId, missing);
    }
  }

  return rows.length + backfilled;
}

/**
 * One-off heal for rows synced before incremental sync included status
 * transitions: re-fetch every locally-open invoice by ID so ones that went
 * PAID/VOIDED/DELETED in Xero get their real status. Idempotent; safe to
 * re-run (it only refreshes rows to Xero's current truth).
 */
export async function healInvoiceStatuses(connectionId: string): Promise<number> {
  const { data } = await supabase
    .from("xero_invoices")
    .select("xero_id")
    .eq("connection_id", connectionId)
    .in("status", ["AUTHORISED", "SUBMITTED", "DRAFT"]);
  const ids = (data || []).map((r) => r.xero_id as string);
  if (ids.length === 0) return 0;
  return fetchInvoicesByIds(connectionId, ids);
}

async function syncBankTransactions(
  connectionId: string,
  since: string
): Promise<number> {
  const params: Record<string, string> = {
    where: `Date>=${xeroDateFilter(new Date(since))}`,
  };

  const transactions = await xeroRequestPaginated<XeroBankTransaction>(
    connectionId,
    "BankTransactions",
    "BankTransactions",
    params
  );

  const rows: Record<string, unknown>[] = [];
  for (const txn of transactions) {
    const txnDate = parseXeroDate(txn.Date);
    if (!txnDate) {
      console.warn(`Skipping bank txn ${txn.BankTransactionID}: invalid date`, txn.Date);
      continue;
    }
    rows.push({
      connection_id: connectionId,
      xero_id: txn.BankTransactionID,
      type: txn.Type,
      contact_name: txn.Contact?.Name || null,
      account_code: txn.BankAccount?.Code || null,
      account_name: txn.BankAccount?.Name || null,
      total: txn.Total,
      date: txnDate,
      status: txn.Status,
      is_reconciled: txn.IsReconciled,
      line_items: txn.LineItems || null,
      xero_updated_at: parseXeroDateTime(txn.UpdatedDateUTC),
    });
  }

  await chunkedUpsert("xero_bank_transactions", rows, "connection_id,xero_id");
  return rows.length;
}
