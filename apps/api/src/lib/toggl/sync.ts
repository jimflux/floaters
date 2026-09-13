import { supabase } from "@/lib/supabase";
import { chunkedUpsert, HISTORY_MONTHS } from "@/lib/xero/sync";
import { togglRequest, isTogglConfigured } from "./client";
import type { TogglMe, TogglClient, TogglProject, TogglTimeEntry } from "@/types/toggl";
import { addMonths, startOfMonth, subMonths, subHours, format } from "date-fns";

// Toggl sync: clients, projects and time entries into the toggl_* tables.
// Initial sync walks HISTORY_MONTHS month by month (the same depth as the cash
// history, so hours and cash cover the same window); incremental syncs use
// Toggl's `since` cursor, which also returns deletions.

// Toggl's `since` cursor only reaches back about three months; older than
// this we fall back to a full re-walk rather than silently missing entries.
const SINCE_MAX_DAYS = 60;
const PROJECTS_PAGE = 200;

export interface TogglSyncResult {
  clients: number;
  projects: number;
  entries: number;
  workspaceId: number;
  full: boolean;
}

function toIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function mapClient(connectionId: string, c: TogglClient) {
  return {
    connection_id: connectionId,
    toggl_id: c.id,
    name: c.name,
    archived: c.archived === true,
    toggl_updated_at: toIso(c.at),
    updated_at: new Date().toISOString(),
    // client_key is a local link column and is deliberately omitted.
  };
}

export function mapProject(connectionId: string, p: TogglProject) {
  return {
    connection_id: connectionId,
    toggl_id: p.id,
    toggl_client_id: p.client_id ?? null,
    name: p.name,
    active: p.active !== false && !p.server_deleted_at,
    billable: p.billable ?? null,
    rate: p.rate ?? null,
    currency: p.currency ?? null,
    color: p.color ?? null,
    toggl_updated_at: toIso(p.at),
    updated_at: new Date().toISOString(),
  };
}

export function mapTimeEntry(connectionId: string, e: TogglTimeEntry) {
  const running = e.duration < 0 || e.stop === null;
  return {
    connection_id: connectionId,
    toggl_id: e.id,
    workspace_id: e.workspace_id ?? null,
    project_id: e.project_id ?? null,
    project_name: e.project_name ?? null,
    client_name: e.client_name ?? null,
    description: e.description ?? null,
    start: toIso(e.start) ?? e.start,
    stop: running ? null : toIso(e.stop),
    duration_seconds: running ? null : Math.max(0, Math.round(e.duration)),
    billable: e.billable === true,
    tags: e.tags ?? [],
    toggl_updated_at: toIso(e.at),
    deleted_at: toIso(e.server_deleted_at),
    updated_at: new Date().toISOString(),
  };
}

// Toggl list endpoints return a bare array in practice; the docs describe an
// { items } envelope. Accept both.
function items<T>(response: unknown): T[] {
  if (Array.isArray(response)) return response as T[];
  const wrapped = (response as { items?: T[] } | null)?.items;
  return Array.isArray(wrapped) ? wrapped : [];
}

export async function resolveWorkspaceId(stored: number | null): Promise<number> {
  const fromEnv = Number(process.env.TOGGL_WORKSPACE_ID);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  if (stored) return stored;
  const me = await togglRequest<TogglMe>("/me");
  if (!me?.default_workspace_id) throw new Error("Toggl /me returned no default workspace");
  return me.default_workspace_id;
}

export async function fetchClients(workspaceId: number): Promise<TogglClient[]> {
  return items<TogglClient>(await togglRequest(`/workspaces/${workspaceId}/clients`, { status: "both" }));
}

export async function fetchProjects(workspaceId: number): Promise<TogglProject[]> {
  const all: TogglProject[] = [];
  let page = 1;
  while (true) {
    const batch = items<TogglProject>(
      await togglRequest(`/workspaces/${workspaceId}/projects`, {
        active: "both",
        per_page: PROJECTS_PAGE,
        page,
      })
    );
    all.push(...batch);
    if (batch.length < PROJECTS_PAGE) break;
    page++;
  }
  return all;
}

/** The [start, end) month windows an initial sync walks, oldest first. */
export function historyWindows(now: Date, months = HISTORY_MONTHS): Array<{ start: string; end: string }> {
  const windows: Array<{ start: string; end: string }> = [];
  let cursor = startOfMonth(subMonths(now, months));
  const stop = startOfMonth(addMonths(now, 1));
  while (cursor < stop) {
    const next = addMonths(cursor, 1);
    windows.push({ start: format(cursor, "yyyy-MM-dd"), end: format(next, "yyyy-MM-dd") });
    cursor = next;
  }
  return windows;
}

export async function fetchEntriesFull(now: Date): Promise<TogglTimeEntry[]> {
  const seen = new Map<number, TogglTimeEntry>();
  for (const w of historyWindows(now)) {
    const batch = items<TogglTimeEntry>(
      await togglRequest("/me/time_entries", { start_date: w.start, end_date: w.end, meta: true })
    );
    for (const e of batch) seen.set(e.id, e);
  }
  return [...seen.values()];
}

export async function fetchEntriesSince(since: Date): Promise<TogglTimeEntry[]> {
  return items<TogglTimeEntry>(
    await togglRequest("/me/time_entries", { since: Math.floor(since.getTime() / 1000), meta: true })
  );
}

export async function runTogglSync(connectionId: string, opts: { full?: boolean } = {}): Promise<TogglSyncResult> {
  if (!isTogglConfigured()) throw new Error("TOGGL_API_TOKEN is not set");

  const { data: state } = await supabase
    .from("toggl_state")
    .select("workspace_id, last_synced_at")
    .eq("connection_id", connectionId)
    .maybeSingle();

  await supabase.from("toggl_state").upsert(
    { connection_id: connectionId, sync_status: "syncing", sync_error: null, updated_at: new Date().toISOString() },
    { onConflict: "connection_id" }
  );

  try {
    const now = new Date();
    const workspaceId = await resolveWorkspaceId(state?.workspace_id ? Number(state.workspace_id) : null);

    const lastSynced = state?.last_synced_at ? new Date(state.last_synced_at) : null;
    const tooOld = lastSynced ? now.getTime() - lastSynced.getTime() > SINCE_MAX_DAYS * 86400_000 : true;
    const full = opts.full === true || !lastSynced || tooOld;

    const clients = await fetchClients(workspaceId);
    const projects = await fetchProjects(workspaceId);
    // Overlap the cursor by an hour so a clock skew never drops an edit.
    const entries = full ? await fetchEntriesFull(now) : await fetchEntriesSince(subHours(lastSynced!, 1));

    if (clients.length) {
      await chunkedUpsert("toggl_clients", clients.map((c) => mapClient(connectionId, c)), "connection_id,toggl_id");
    }
    if (projects.length) {
      await chunkedUpsert("toggl_projects", projects.map((p) => mapProject(connectionId, p)), "connection_id,toggl_id");
    }
    if (entries.length) {
      await chunkedUpsert("toggl_time_entries", entries.map((e) => mapTimeEntry(connectionId, e)), "connection_id,toggl_id");
    }

    await supabase.from("toggl_state").upsert(
      {
        connection_id: connectionId,
        workspace_id: workspaceId,
        sync_status: "idle",
        sync_error: null,
        last_synced_at: now.toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "connection_id" }
    );

    return { clients: clients.length, projects: projects.length, entries: entries.length, workspaceId, full };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await supabase.from("toggl_state").upsert(
      { connection_id: connectionId, sync_status: "error", sync_error: message, updated_at: new Date().toISOString() },
      { onConflict: "connection_id" }
    );
    throw err;
  }
}
