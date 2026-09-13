import { clientKey } from "@/lib/pipeline";
import type { TimeClient, TimeProject, RunningTimeEntry } from "@/types/api";

// Pure rollup of synced Toggl rows into the /api/time shape. Everything here is
// hours: cash never enters. Entries bucket by their START day in TIME_ZONE
// (Toggl stores UTC; a 23:30 BST entry belongs to that local day).

export type EntryRow = {
  toggl_id: number | string;
  project_id: number | string | null;
  project_name?: string | null;
  client_name?: string | null;
  description: string | null;
  start: string;
  stop: string | null;
  duration_seconds: number | string | null;
  billable: boolean | null;
  tags?: string[] | null;
  deleted_at?: string | null;
};

export type ProjectRow = {
  toggl_id: number | string;
  toggl_client_id: number | string | null;
  name: string;
  active: boolean | null;
  billable: boolean | null;
  rate: number | string | null;
  currency: string | null;
  color: string | null;
};

export type ClientRow = {
  toggl_id: number | string;
  name: string;
  client_key?: string | null; // manual link to a pipeline client
};

export type LinkOption = { clientKey: string; clientName: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** yyyy-MM-dd of an instant in the given IANA zone. */
export function localDate(iso: string | Date, timeZone: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  // en-CA formats as yyyy-MM-dd.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Monday (yyyy-MM-dd) of the local week containing the instant. */
export function weekStart(iso: string | Date, timeZone: string): string {
  const day = localDate(iso, timeZone);
  // Day-of-week of a yyyy-MM-dd is zone-independent once we have the local date.
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7; // days since Monday
  const monday = new Date(`${day}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - back);
  return monday.toISOString().slice(0, 10);
}

/** Seconds an entry has run: stored duration, or live from start when running. */
export function entrySeconds(entry: Pick<EntryRow, "start" | "stop" | "duration_seconds">, now: Date): number {
  const stored = entry.duration_seconds === null || entry.duration_seconds === undefined
    ? null
    : Number(entry.duration_seconds);
  if (stored !== null && Number.isFinite(stored) && stored >= 0) return stored;
  const started = new Date(entry.start).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((now.getTime() - started) / 1000));
}

export function isRunning(entry: Pick<EntryRow, "stop" | "duration_seconds" | "deleted_at">): boolean {
  if (entry.deleted_at) return false;
  const d = entry.duration_seconds === null || entry.duration_seconds === undefined ? null : Number(entry.duration_seconds);
  return entry.stop === null && (d === null || d < 0);
}

const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// Shortest Toggl client name allowed to match by containment: anything
// shorter would link on noise ("AI" is inside half the contact list).
const MIN_CONTAINMENT_LENGTH = 4;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when `needle` appears in `haystack` as whole words (both normalised). */
export function containsWords(haystack: string, needle: string): boolean {
  if (needle.length < MIN_CONTAINMENT_LENGTH) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}($|[^a-z0-9])`).test(haystack);
}

/**
 * Resolve a Toggl client to a pipeline client key: an explicit link wins, else
 * a name match against the known pipeline clients (contact name or projection
 * label), else unlinked. Names match exactly (normalised) first; failing that,
 * a Toggl name that appears whole inside exactly one pipeline name links to it
 * ("Propellernet" -> "Propellernet Ltd", "Edifai" -> "Coteam Ltd, trading as
 * Edifai"). An ambiguous containment (two candidates) never links: Jim sets
 * that one by hand.
 */
export function resolveClientLink(
  togglClient: ClientRow,
  linkOptions: LinkOption[]
): { clientKey: string | null; linkSource: "manual" | "auto" | null } {
  if (togglClient.client_key) return { clientKey: togglClient.client_key, linkSource: "manual" };
  const wanted = normalise(togglClient.name);
  if (!wanted) return { clientKey: null, linkSource: null };
  const byName = linkOptions.find((o) => normalise(o.clientName) === wanted);
  if (byName) return { clientKey: byName.clientKey, linkSource: "auto" };
  // A label-keyed pipeline client is its normalised name; match the key form too.
  const labelKey = clientKey(null, togglClient.name);
  const byKey = linkOptions.find((o) => o.clientKey === labelKey);
  if (byKey) return { clientKey: byKey.clientKey, linkSource: "auto" };
  const containing = linkOptions.filter((o) => containsWords(normalise(o.clientName), wanted));
  if (containing.length === 1) return { clientKey: containing[0].clientKey, linkSource: "auto" };
  return { clientKey: null, linkSource: null };
}

export const NO_CLIENT_NAME = "No client";

export interface RollupInput {
  entries: EntryRow[];
  projects: ProjectRow[];
  clients: ClientRow[];
  months: string[];
  now: Date;
  timeZone: string;
  linkOptions: LinkOption[];
  // clientKey -> month -> Σ invoice totals ex VAT (issue month). Optional.
  invoicedByClientMonth?: Map<string, Map<string, number>>;
}

export interface RollupResult {
  clients: TimeClient[];
  totals: { hours: number[]; billableHours: number[] };
  todayHours: number;
  weekHours: number;
  running: RunningTimeEntry | null;
}

export function rollupTime(input: RollupInput): RollupResult {
  const { entries, projects, clients, months, now, timeZone, linkOptions } = input;
  const monthIndex = new Map(months.map((m, i) => [m, i]));
  const zeros = () => months.map(() => 0);

  const projectById = new Map(projects.map((p) => [String(p.toggl_id), p]));
  const clientById = new Map(clients.map((c) => [String(c.toggl_id), c]));

  type ClientAgg = {
    togglClientId: number | null;
    clientName: string;
    hours: number[];
    billableHours: number[];
    projects: Map<string, TimeProject>;
  };
  const aggs = new Map<string, ClientAgg>();
  const aggFor = (id: number | null, name: string): ClientAgg => {
    const key = id === null ? "none" : String(id);
    let agg = aggs.get(key);
    if (!agg) {
      agg = { togglClientId: id, clientName: name, hours: zeros(), billableHours: zeros(), projects: new Map() };
      aggs.set(key, agg);
    }
    return agg;
  };

  const totals = { hours: zeros(), billableHours: zeros() };
  const today = localDate(now, timeZone);
  const thisWeek = weekStart(now, timeZone);
  let todaySeconds = 0;
  let weekSeconds = 0;
  let running: RunningTimeEntry | null = null;

  for (const entry of entries) {
    if (entry.deleted_at) continue;
    const seconds = entrySeconds(entry, now);
    const day = localDate(entry.start, timeZone);
    const month = day.slice(0, 7);
    const billable = entry.billable === true;

    const project = entry.project_id === null || entry.project_id === undefined
      ? undefined
      : projectById.get(String(entry.project_id));
    const togglClient = project?.toggl_client_id === null || project?.toggl_client_id === undefined
      ? undefined
      : clientById.get(String(project.toggl_client_id));
    const clientId = togglClient ? Number(togglClient.toggl_id) : null;
    const clientName = togglClient?.name ?? entry.client_name ?? NO_CLIENT_NAME;
    const agg = aggFor(clientId, clientName);

    if (isRunning(entry) && (!running || entry.start > running.startedAt)) {
      running = {
        togglId: Number(entry.toggl_id),
        description: entry.description ?? null,
        projectName: project?.name ?? entry.project_name ?? null,
        clientName: togglClient ? togglClient.name : entry.client_name ?? null,
        startedAt: new Date(entry.start).toISOString(),
        billable,
      };
    }

    if (day === today) todaySeconds += seconds;
    if (day >= thisWeek && day <= today) weekSeconds += seconds;

    const mi = monthIndex.get(month);
    if (mi === undefined) continue;
    const hours = seconds / 3600;
    agg.hours[mi] += hours;
    totals.hours[mi] += hours;
    if (billable) {
      agg.billableHours[mi] += hours;
      totals.billableHours[mi] += hours;
    }

    // Per-project breakdown (entries without a project roll into a synthetic
    // "No project" line so client hours always sum to their projects).
    const projectId = project ? Number(project.toggl_id) : entry.project_id !== null && entry.project_id !== undefined ? Number(entry.project_id) : 0;
    const pkey = String(projectId);
    let tp = agg.projects.get(pkey);
    if (!tp) {
      tp = {
        togglProjectId: projectId,
        name: project?.name ?? entry.project_name ?? "No project",
        billable: project?.billable === true,
        rate: project?.rate === null || project?.rate === undefined ? null : Number(project.rate),
        currency: project?.currency ?? null,
        color: project?.color ?? null,
        active: project?.active !== false,
        hours: zeros(),
        billableHours: zeros(),
      };
      agg.projects.set(pkey, tp);
    }
    tp.hours[mi] += hours;
    if (billable) tp.billableHours[mi] += hours;
  }

  const sumAll = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

  const out: TimeClient[] = [...aggs.values()].map((agg) => {
    const togglClient = agg.togglClientId === null ? undefined : clientById.get(String(agg.togglClientId));
    const link = togglClient ? resolveClientLink(togglClient, linkOptions) : { clientKey: null, linkSource: null as null };
    const invoiced = link.clientKey ? input.invoicedByClientMonth?.get(link.clientKey) : undefined;
    const client: TimeClient = {
      togglClientId: agg.togglClientId,
      clientName: agg.clientName,
      clientKey: link.clientKey,
      linkSource: link.linkSource,
      hours: agg.hours.map(round2),
      billableHours: agg.billableHours.map(round2),
      projects: [...agg.projects.values()]
        .map((p) => ({ ...p, hours: p.hours.map(round2), billableHours: p.billableHours.map(round2) }))
        .sort((a, b) => sumAll(b.hours) - sumAll(a.hours)),
    };
    if (link.clientKey) {
      client.invoicedExVat = months.map((m) => round2(invoiced?.get(m) ?? 0));
    }
    return client;
  });

  // Most-worked clients first; the no-client bucket always last.
  out.sort((a, b) => {
    if (a.togglClientId === null && b.togglClientId !== null) return 1;
    if (b.togglClientId === null && a.togglClientId !== null) return -1;
    return sumAll(b.hours) - sumAll(a.hours);
  });

  return {
    clients: out,
    totals: { hours: totals.hours.map(round2), billableHours: totals.billableHours.map(round2) },
    todayHours: round2(todaySeconds / 3600),
    weekHours: round2(weekSeconds / 3600),
    running,
  };
}
