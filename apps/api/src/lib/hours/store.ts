import { supabase } from "@/lib/supabase";
import { clientKey } from "@/lib/pipeline";
import type { LinkOption } from "./rollup";

// Supabase reads and writes for the hours routes. Hours themselves come live
// from BurnBar; only the client links live here.
//
// Links reuse the Toggl-era table toggl_clients (migration 012): one row per
// BurnBar client id in toggl_id, the pipeline client key in client_key.
// BurnBar kept the Toggl client ids, so links set in the Toggl days still
// apply. Newer BurnBar ids (from 1e10) fit the bigint column.

/** BurnBar client id -> explicit pipeline client key. */
export async function fetchClientLinks(connectionId: string): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("toggl_clients")
    .select("toggl_id, client_key")
    .eq("connection_id", connectionId)
    .not("client_key", "is", null);
  const links = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.client_key) links.set(String(row.toggl_id), row.client_key as string);
  }
  return links;
}

/** Sets (or, with null, clears) the explicit link for one BurnBar client. */
export async function saveClientLink(
  connectionId: string,
  client: { id: number; name: string },
  key: string | null
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("toggl_clients").upsert(
    {
      connection_id: connectionId,
      toggl_id: client.id,
      name: client.name,
      client_key: key,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connection_id,toggl_id" }
  );
  return { error: error ? error.message : null };
}

/**
 * The pipeline clients a BurnBar client can be linked to: every client key seen
 * on an ACCREC invoice or an income projection, named from the most recent
 * invoice contact name (projection labels otherwise).
 */
export async function fetchLinkOptions(connectionId: string): Promise<LinkOption[]> {
  const [{ data: invoices }, { data: projections }] = await Promise.all([
    supabase
      .from("xero_invoices")
      .select("contact_id, contact_name, xero_updated_at")
      .eq("connection_id", connectionId)
      .eq("type", "ACCREC")
      .order("xero_updated_at", { ascending: false }),
    supabase
      .from("income_projections")
      .select("contact_id, client_label")
      .eq("connection_id", connectionId),
  ]);
  const options = new Map<string, string>();
  for (const inv of invoices ?? []) {
    const key = clientKey(inv.contact_id as string | null, inv.contact_name as string | null);
    if (key === "UNASSIGNED" || options.has(key)) continue;
    options.set(key, (inv.contact_name as string | null) ?? key);
  }
  for (const p of projections ?? []) {
    const key = clientKey(p.contact_id as string | null, p.client_label as string | null);
    if (key === "UNASSIGNED" || options.has(key)) continue;
    options.set(key, (p.client_label as string | null) ?? key);
  }
  return [...options.entries()]
    .map(([k, name]) => ({ clientKey: k, clientName: name }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName));
}

/**
 * Σ ACCREC invoice totals ex VAT by client key and issue month. Uses the real
 * synced tax where known; an un-backfilled (NULL tax) invoice counts at its
 * VAT-inclusive total, so run the tax backfill for a clean ex-VAT figure.
 */
export async function fetchInvoicedByClientMonth(
  connectionId: string,
  fromDate: string
): Promise<Map<string, Map<string, number>>> {
  const { data } = await supabase
    .from("xero_invoices")
    .select("contact_id, contact_name, total, total_tax, issue_date, status")
    .eq("connection_id", connectionId)
    .eq("type", "ACCREC")
    .gte("issue_date", fromDate);
  const out = new Map<string, Map<string, number>>();
  for (const inv of data ?? []) {
    const status = inv.status as string | null;
    if (status === "VOIDED" || status === "DELETED" || status === "DRAFT") continue;
    const key = clientKey(inv.contact_id as string | null, inv.contact_name as string | null);
    const month = String(inv.issue_date).slice(0, 7);
    const exVat = Number(inv.total ?? 0) - Number(inv.total_tax ?? 0);
    if (!out.has(key)) out.set(key, new Map());
    const byMonth = out.get(key)!;
    byMonth.set(month, (byMonth.get(month) ?? 0) + exVat);
  }
  return out;
}
