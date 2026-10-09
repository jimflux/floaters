import { z } from "zod/v4";

// BurnBar (Jim's own time tracker, https://burn.flux.am) is the only source of
// hours. It is read live with a read-only bearer key (BURNBAR_READ_TOKEN, GET
// only) and held in memory for a minute so the dashboard stays quick. Nothing
// is copied into Supabase. The key is env only: never stored, never logged.
// Contract: docs/SYNC.md in the burnbar repo.

// The zone entries are bucketed into local days and months by. BurnBar uses
// the same one for its own "today".
export const HOURS_TIME_ZONE = "Europe/London";

// Hours start in January 2026, when BurnBar took over from Toggl. Nothing
// earlier is read or shown. Local midnight on 1 January is 00:00 UTC (GMT).
export const HOURS_FROM = "2026-01-01";
const HOURS_FROM_ISO = `${HOURS_FROM}T00:00:00Z`;

export const CACHE_MS = 60_000;
// After a failed read, wait this long before trying again, so a BurnBar
// outage doesn't make every request wait for the timeout.
export const RETRY_MS = 30_000;
// BurnBar caps one /api/entries call at 400 days.
const MAX_RANGE_DAYS = 400;
const DAY_MS = 86_400_000;
const TIMEOUT_MS = 10_000;

export function burnbarConfig(): { url: string; token: string } | null {
  const url = process.env.BURNBAR_URL?.trim().replace(/\/+$/, "");
  const token = process.env.BURNBAR_READ_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

export function isBurnBarConfigured(): boolean {
  return burnbarConfig() !== null;
}

const clientSchema = z.object({
  id: z.number(),
  name: z.string(),
  archived: z.boolean().default(false),
  deleted: z.boolean().default(false),
});

const projectSchema = z.object({
  id: z.number(),
  clientId: z.number().nullable().default(null),
  name: z.string(),
  archived: z.boolean().default(false),
  deleted: z.boolean().default(false),
});

const entrySchema = z.object({
  id: z.string(),
  description: z.string().nullable().default(null),
  // Set only when projectId is null; a project's client comes from the project.
  clientId: z.number().nullable().default(null),
  projectId: z.number().nullable().default(null),
  start: z.string(),
  end: z.string().nullable().default(null), // null while running
  deleted: z.boolean().default(false),
});

const stateSchema = z.object({
  clients: z.array(clientSchema),
  projects: z.array(projectSchema),
  // Archived or deleted clients and projects, so old entries can still be named.
  hidden: z
    .object({
      clients: z.array(clientSchema).default([]),
      projects: z.array(projectSchema).default([]),
    })
    .optional(),
});

const entriesSchema = z.object({ entries: z.array(entrySchema) });

export type BurnBarClient = z.infer<typeof clientSchema>;
export type BurnBarProject = z.infer<typeof projectSchema>;
export type BurnBarEntry = z.infer<typeof entrySchema>;

export interface BurnBarData {
  clients: BurnBarClient[]; // visible and hidden
  projects: BurnBarProject[]; // visible and hidden
  entries: BurnBarEntry[]; // not deleted, from HOURS_FROM, ordered by start
  fetchedAt: string; // ISO
}

async function get<T>(config: { url: string; token: string }, path: string, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${config.url}${path}`, {
    headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const route = path.split("?")[0];
  if (!response.ok) throw new Error(`BurnBar ${route} returned ${response.status}`);
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error(`BurnBar ${route} sent an unexpected shape`);
  return parsed.data;
}

function uniqueById<T extends { id: number }>(rows: T[]): T[] {
  const byId = new Map<number, T>();
  for (const row of rows) if (!byId.has(row.id)) byId.set(row.id, row);
  return [...byId.values()];
}

/** One read of everything the hours surfaces need, straight from BurnBar. */
export async function fetchBurnBar(now = new Date()): Promise<BurnBarData> {
  const config = burnbarConfig();
  if (!config) throw new Error("BurnBar is not set up");

  // Up to two days ahead covers clock drift between BurnBar and here.
  const end = now.getTime() + 2 * DAY_MS;
  const ranges: Array<[string, string]> = [];
  for (let from = Date.parse(HOURS_FROM_ISO); from < end; from += MAX_RANGE_DAYS * DAY_MS) {
    const to = Math.min(from + MAX_RANGE_DAYS * DAY_MS, end);
    ranges.push([new Date(from).toISOString(), new Date(to).toISOString()]);
  }

  const [state, ...pages] = await Promise.all([
    get(config, "/api/state", stateSchema),
    ...ranges.map(([from, to]) =>
      get(config, `/api/entries?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, entriesSchema)
    ),
  ]);

  // Entry ids are UUIDs, uppercase from the Mac: compare case-insensitively.
  const seen = new Set<string>();
  const entries: BurnBarEntry[] = [];
  for (const page of pages) {
    for (const entry of page.entries) {
      const key = entry.id.toLowerCase();
      if (entry.deleted || seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }
  entries.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  return {
    clients: uniqueById([...state.clients, ...(state.hidden?.clients ?? [])]),
    projects: uniqueById([...state.projects, ...(state.hidden?.projects ?? [])]),
    entries,
    fetchedAt: now.toISOString(),
  };
}

let cache: { data: BurnBarData; at: number } | null = null;
let inflight: Promise<BurnBarData> | null = null;
let failure: { message: string; at: number } | null = null;

/**
 * BurnBar data, from memory when the last read is under a minute old.
 * Concurrent callers share one read. `fresh` skips the memory copy.
 */
export async function loadBurnBar(options: { fresh?: boolean } = {}): Promise<BurnBarData> {
  if (!options.fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (!options.fresh && failure && Date.now() - failure.at < RETRY_MS) throw new Error(failure.message);
  if (inflight) return inflight;
  inflight = fetchBurnBar(new Date())
    .then((data) => {
      cache = { data, at: Date.now() };
      failure = null;
      return data;
    })
    .catch((err: unknown) => {
      failure = { message: err instanceof Error ? err.message : "Unknown error", at: Date.now() };
      throw err;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Like loadBurnBar, but never throws: a failed read returns the last good copy
 * (if any) with the error, so the dashboard keeps showing hours.
 */
export async function readBurnBar(
  options: { fresh?: boolean } = {}
): Promise<{ data: BurnBarData | null; error: string | null }> {
  try {
    return { data: await loadBurnBar(options), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("BurnBar read failed:", message);
    return { data: cache?.data ?? null, error: message };
  }
}

/** Tests only. */
export function resetBurnBarCache(): void {
  cache = null;
  inflight = null;
  failure = null;
}
