import { clientKey } from "@/lib/pipeline";
import type { TimeClient, TimeProject, RunningTimeEntry, TimeEntry } from "@/types/api";
import type { BurnBarClient, BurnBarEntry, BurnBarProject } from "./burnbar";

// Pure rollup of BurnBar data into the /api/time and /api/time/entries shapes.
// Everything here is hours: cash never enters. Entries bucket by their START
// day in the given zone (BurnBar stores UTC; a 23:30 BST entry belongs to that
// local day). BurnBar has no billable flag, rates or colours, so those fields
// are always false or null.

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

export function isRunning(entry: Pick<BurnBarEntry, "end">): boolean {
  return entry.end === null || entry.end === undefined;
}

/** Seconds an entry has run: start to end, or start to now while running. */
export function entrySeconds(entry: Pick<BurnBarEntry, "start" | "end">, now: Date): number {
  const started = Date.parse(entry.start);
  if (!Number.isFinite(started)) return 0;
  const ended = isRunning(entry) ? now.getTime() : Date.parse(entry.end!);
  if (!Number.isFinite(ended)) return 0;
  return Math.max(0, Math.floor((ended - started) / 1000));
}

const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// Shortest client name allowed to match by containment: anything shorter
// would link on noise ("AI" is inside half the contact list).
const MIN_CONTAINMENT_LENGTH = 4;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when `needle` appears in `haystack` as whole words (both normalised). */
export function containsWords(haystack: string, needle: string): boolean {
  if (needle.length < MIN_CONTAINMENT_LENGTH) return false;
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}($|[^a-z0-9])`).test(haystack);
}

/**
 * Resolve a time-tracking client to a pipeline client key: an explicit link
 * wins, else a name match against the known pipeline clients (contact name or
 * projection label), else unlinked. Names match exactly (normalised) first;
 * failing that, a name that appears whole inside exactly one pipeline name
 * links to it ("Propellernet" -> "Propellernet Ltd", "Edifai" -> "Coteam Ltd,
 * trading as Edifai"). An ambiguous containment (two candidates) never links:
 * Jim sets that one by hand.
 */
export function resolveClientLink(
  client: { name: string; clientKey?: string | null },
  linkOptions: LinkOption[]
): { clientKey: string | null; linkSource: "manual" | "auto" | null } {
  if (client.clientKey) return { clientKey: client.clientKey, linkSource: "manual" };
  const wanted = normalise(client.name);
  if (!wanted) return { clientKey: null, linkSource: null };
  const byName = linkOptions.find((o) => normalise(o.clientName) === wanted);
  if (byName) return { clientKey: byName.clientKey, linkSource: "auto" };
  // A label-keyed pipeline client is its normalised name; match the key form too.
  const labelKey = clientKey(null, client.name);
  const byKey = linkOptions.find((o) => o.clientKey === labelKey);
  if (byKey) return { clientKey: byKey.clientKey, linkSource: "auto" };
  const containing = linkOptions.filter((o) => containsWords(normalise(o.clientName), wanted));
  if (containing.length === 1) return { clientKey: containing[0].clientKey, linkSource: "auto" };
  return { clientKey: null, linkSource: null };
}

export const NO_CLIENT_NAME = "No client";

export interface HoursData {
  clients: BurnBarClient[];
  projects: BurnBarProject[];
  entries: BurnBarEntry[];
}

/**
 * Finds each entry's project and client. An entry names its client directly
 * only when it has no project; otherwise the client comes from the project.
 * `links` maps a BurnBar client id to an explicit pipeline client key.
 */
export function entryResolver(data: HoursData, links: Map<string, string>, linkOptions: LinkOption[]) {
  const projectById = new Map(data.projects.map((p) => [p.id, p]));
  const clientById = new Map(data.clients.map((c) => [c.id, c]));
  const linkCache = new Map<number, ReturnType<typeof resolveClientLink>>();
  const linkFor = (client: BurnBarClient) => {
    let link = linkCache.get(client.id);
    if (!link) {
      link = resolveClientLink({ name: client.name, clientKey: links.get(String(client.id)) ?? null }, linkOptions);
      linkCache.set(client.id, link);
    }
    return link;
  };
  const resolve = (entry: BurnBarEntry) => {
    const project = entry.projectId === null ? undefined : projectById.get(entry.projectId);
    const clientId = entry.projectId === null ? entry.clientId : project?.clientId ?? null;
    const client = clientId === null ? undefined : clientById.get(clientId);
    return { project, client };
  };
  return { resolve, linkFor };
}

export interface RollupInput extends HoursData {
  links: Map<string, string>;
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
  const { entries, months, now, timeZone, linkOptions } = input;
  const monthIndex = new Map(months.map((m, i) => [m, i]));
  const zeros = () => months.map(() => 0);
  const { resolve, linkFor } = entryResolver(input, input.links, linkOptions);

  type ClientAgg = {
    client: BurnBarClient | undefined;
    clientName: string;
    hours: number[];
    projects: Map<number, TimeProject>;
  };
  const aggs = new Map<string, ClientAgg>();
  const aggFor = (client: BurnBarClient | undefined): ClientAgg => {
    const key = client ? String(client.id) : "none";
    let agg = aggs.get(key);
    if (!agg) {
      agg = { client, clientName: client?.name ?? NO_CLIENT_NAME, hours: zeros(), projects: new Map() };
      aggs.set(key, agg);
    }
    return agg;
  };

  const totals = zeros();
  const today = localDate(now, timeZone);
  const thisWeek = weekStart(now, timeZone);
  let todaySeconds = 0;
  let weekSeconds = 0;
  let running: { entry: BurnBarEntry; value: RunningTimeEntry } | null = null;

  for (const entry of entries) {
    // Skip deleted entries, and any logged ahead of now (the read runs two days past it).
    if (entry.deleted || Date.parse(entry.start) > now.getTime()) continue;
    const seconds = entrySeconds(entry, now);
    const day = localDate(entry.start, timeZone);
    const { project, client } = resolve(entry);

    // Several entries can run at once; the latest started is the one shown.
    if (isRunning(entry) && (!running || Date.parse(entry.start) > Date.parse(running.entry.start))) {
      running = {
        entry,
        value: {
          togglId: entry.id,
          description: entry.description || null,
          projectName: project?.name ?? null,
          clientName: client?.name ?? null,
          startedAt: new Date(entry.start).toISOString(),
          billable: false,
        },
      };
    }

    if (day === today) todaySeconds += seconds;
    if (day >= thisWeek && day <= today) weekSeconds += seconds;

    const mi = monthIndex.get(day.slice(0, 7));
    if (mi === undefined) continue;
    const hours = seconds / 3600;
    const agg = aggFor(client);
    agg.hours[mi] += hours;
    totals[mi] += hours;

    // Per-project breakdown (entries without a project roll into a synthetic
    // "No project" line so client hours always sum to their projects).
    const projectId = project?.id ?? entry.projectId ?? 0;
    let tp = agg.projects.get(projectId);
    if (!tp) {
      tp = {
        togglProjectId: projectId,
        name: project?.name ?? "No project",
        billable: false,
        rate: null,
        currency: null,
        color: null,
        active: project ? !project.archived && !project.deleted : true,
        hours: zeros(),
        billableHours: zeros(),
      };
      agg.projects.set(projectId, tp);
    }
    tp.hours[mi] += hours;
  }

  const sumAll = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

  const out: TimeClient[] = [...aggs.values()].map((agg) => {
    const link = agg.client ? linkFor(agg.client) : { clientKey: null, linkSource: null };
    const invoiced = link.clientKey ? input.invoicedByClientMonth?.get(link.clientKey) : undefined;
    const client: TimeClient = {
      togglClientId: agg.client ? agg.client.id : null,
      clientName: agg.clientName,
      clientKey: link.clientKey,
      linkSource: link.linkSource,
      hours: agg.hours.map(round2),
      billableHours: zeros(),
      projects: [...agg.projects.values()]
        .map((p) => ({ ...p, hours: p.hours.map(round2) }))
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
    totals: { hours: totals.map(round2), billableHours: zeros() },
    todayHours: round2(todaySeconds / 3600),
    weekHours: round2(weekSeconds / 3600),
    running: running?.value ?? null,
  };
}

/** Entries whose local start day is in [from, to] (yyyy-MM-dd), newest first. */
export function listEntries(input: {
  data: HoursData;
  links: Map<string, string>;
  linkOptions: LinkOption[];
  from: string;
  to: string;
  now: Date;
  timeZone: string;
}): { entries: TimeEntry[]; totalHours: number; billableHours: number } {
  const { resolve, linkFor } = entryResolver(input.data, input.links, input.linkOptions);
  const out: TimeEntry[] = [];
  let totalSeconds = 0;
  for (const e of input.data.entries) {
    if (e.deleted || Date.parse(e.start) > input.now.getTime()) continue;
    const day = localDate(e.start, input.timeZone);
    if (day < input.from || day > input.to) continue;
    const { project, client } = resolve(e);
    const seconds = entrySeconds(e, input.now);
    totalSeconds += seconds;
    out.push({
      togglId: e.id,
      description: e.description || null,
      projectName: project?.name ?? null,
      clientName: client?.name ?? null,
      clientKey: client ? linkFor(client).clientKey : null,
      start: new Date(e.start).toISOString(),
      stop: e.end ? new Date(e.end).toISOString() : null,
      durationSeconds: seconds,
      hours: round2(seconds / 3600),
      billable: false,
      tags: [],
      running: isRunning(e),
    });
  }
  out.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
  return { entries: out, totalHours: round2(totalSeconds / 3600), billableHours: 0 };
}
