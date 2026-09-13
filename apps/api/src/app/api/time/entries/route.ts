import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import { format, subDays, addDays, differenceInCalendarDays, parseISO, isValid } from "date-fns";
import { z } from "zod/v4";
import { entrySeconds, isRunning, localDate, resolveClientLink } from "@/lib/toggl/rollup";
import { fetchEntries, fetchProjects, fetchClients, fetchLinkOptions } from "@/lib/toggl/store";
import { togglTimeZone } from "@/lib/toggl/client";
import type { TimeEntriesResponse, TimeEntry } from "@/types/api";

// Raw time entries over a local-date range (inclusive), newest first. For the
// MCP server and any agent that wants the detail behind the monthly rollup.

const MAX_RANGE_DAYS = 92;
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

export async function GET(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const { searchParams } = new URL(request.url);
    const fromRaw = dateSchema.safeParse(searchParams.get("from") ?? undefined);
    const toRaw = dateSchema.safeParse(searchParams.get("to") ?? undefined);
    if (!fromRaw.success || !toRaw.success) return error("from/to must be yyyy-MM-dd");

    const tz = togglTimeZone();
    const now = new Date();
    const to = toRaw.data ?? localDate(now, tz);
    const from = fromRaw.data ?? format(subDays(parseISO(to), 6), "yyyy-MM-dd");
    const fromDate = parseISO(from);
    const toDate = parseISO(to);
    if (!isValid(fromDate) || !isValid(toDate) || from > to) return error("from must not be after to");
    if (differenceInCalendarDays(toDate, fromDate) > MAX_RANGE_DAYS) {
      return error(`Range too wide: at most ${MAX_RANGE_DAYS} days`);
    }

    // A day of slack either side for the UTC/local offset; filtered below.
    const [entries, projects, clients, linkOptions] = await Promise.all([
      fetchEntries(connectionId, subDays(fromDate, 1).toISOString(), addDays(toDate, 2).toISOString()),
      fetchProjects(connectionId),
      fetchClients(connectionId),
      fetchLinkOptions(connectionId),
    ]);
    const projectById = new Map(projects.map((p) => [String(p.toggl_id), p]));
    const clientById = new Map(clients.map((c) => [String(c.toggl_id), c]));

    const out: TimeEntry[] = [];
    let totalSeconds = 0;
    let billableSeconds = 0;
    for (const e of entries) {
      if (e.deleted_at) continue;
      const day = localDate(e.start, tz);
      if (day < from || day > to) continue;
      const project = e.project_id === null || e.project_id === undefined ? undefined : projectById.get(String(e.project_id));
      const client = project?.toggl_client_id === null || project?.toggl_client_id === undefined
        ? undefined
        : clientById.get(String(project.toggl_client_id));
      const seconds = entrySeconds(e, now);
      const billable = e.billable === true;
      totalSeconds += seconds;
      if (billable) billableSeconds += seconds;
      out.push({
        togglId: Number(e.toggl_id),
        description: e.description ?? null,
        projectName: project?.name ?? e.project_name ?? null,
        clientName: client?.name ?? e.client_name ?? null,
        clientKey: client ? resolveClientLink(client, linkOptions).clientKey : null,
        start: new Date(e.start).toISOString(),
        stop: e.stop ? new Date(e.stop).toISOString() : null,
        durationSeconds: seconds,
        hours: Math.round((seconds / 3600) * 100) / 100,
        billable,
        tags: e.tags ?? [],
        running: isRunning(e),
      });
    }
    out.sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));

    const response: TimeEntriesResponse = {
      from,
      to,
      timeZone: tz,
      entries: out,
      totalHours: Math.round((totalSeconds / 3600) * 100) / 100,
      billableHours: Math.round((billableSeconds / 3600) * 100) / 100,
    };
    return json(response);
  } catch (err) {
    return handleError(err);
  }
}
