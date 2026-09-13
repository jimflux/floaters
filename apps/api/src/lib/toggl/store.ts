import { supabase } from "@/lib/supabase";
import { clientKey } from "@/lib/pipeline";
import type { ClientRow, EntryRow, ProjectRow, LinkOption } from "./rollup";

// Reads for the time routes. Supabase caps a select at 1000 rows; a year of
// time entries can exceed that, so entries are paged. Missing tables (the
// migration not yet applied) degrade to empty rather than failing the read.

const PAGE = 1000;

export async function fetchEntries(
  connectionId: string,
  fromIso: string,
  toIso?: string
): Promise<EntryRow[]> {
  const all: EntryRow[] = [];
  for (let offset = 0; ; offset += PAGE) {
    let q = supabase
      .from("toggl_time_entries")
      .select("toggl_id, project_id, project_name, client_name, description, start, stop, duration_seconds, billable, tags, deleted_at")
      .eq("connection_id", connectionId)
      .gte("start", fromIso)
      .order("start", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (toIso) q = q.lt("start", toIso);
    const { data, error } = await q;
    if (error || !data) break;
    all.push(...(data as EntryRow[]));
    if (data.length < PAGE) break;
  }
  return all;
}

export async function fetchProjects(connectionId: string): Promise<ProjectRow[]> {
  const { data } = await supabase
    .from("toggl_projects")
    .select("toggl_id, toggl_client_id, name, active, billable, rate, currency, color")
    .eq("connection_id", connectionId);
  return (data as ProjectRow[] | null) ?? [];
}

export async function fetchClients(connectionId: string): Promise<ClientRow[]> {
  const { data } = await supabase
    .from("toggl_clients")
    .select("toggl_id, name, archived, client_key")
    .eq("connection_id", connectionId);
  return (data as ClientRow[] | null) ?? [];
}

export type TogglStateRow = {
  workspace_id: number | null;
  last_synced_at: string | null;
  sync_status: "idle" | "syncing" | "error";
  sync_error: string | null;
};

export async function fetchState(connectionId: string): Promise<TogglStateRow | null> {
  const { data } = await supabase
    .from("toggl_state")
    .select("workspace_id, last_synced_at, sync_status, sync_error")
    .eq("connection_id", connectionId)
    .maybeSingle();
  return (data as TogglStateRow | null) ?? null;
}

/**
 * The pipeline clients a Toggl client can be linked to: every client key seen
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
