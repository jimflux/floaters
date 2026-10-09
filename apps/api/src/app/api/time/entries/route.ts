import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import { format, subDays, differenceInCalendarDays, parseISO, isValid } from "date-fns";
import { z } from "zod/v4";
import { HOURS_TIME_ZONE, isBurnBarConfigured, readBurnBar } from "@/lib/hours/burnbar";
import { listEntries, localDate } from "@/lib/hours/rollup";
import { fetchClientLinks, fetchLinkOptions } from "@/lib/hours/store";
import type { TimeEntriesResponse } from "@/types/api";

// Raw time entries over a local-date range (inclusive), newest first, read
// live from BurnBar. For the MCP server and any agent that wants the detail
// behind the monthly rollup. Nothing before January 2026 is returned.

const MAX_RANGE_DAYS = 92;
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

export async function GET(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const { searchParams } = new URL(request.url);
    const fromRaw = dateSchema.safeParse(searchParams.get("from") ?? undefined);
    const toRaw = dateSchema.safeParse(searchParams.get("to") ?? undefined);
    if (!fromRaw.success || !toRaw.success) return error("from/to must be yyyy-MM-dd");

    const tz = HOURS_TIME_ZONE;
    const now = new Date();
    const to = toRaw.data ?? localDate(now, tz);
    const from = fromRaw.data ?? format(subDays(parseISO(to), 6), "yyyy-MM-dd");
    const fromDate = parseISO(from);
    const toDate = parseISO(to);
    if (!isValid(fromDate) || !isValid(toDate) || from > to) return error("from must not be after to");
    if (differenceInCalendarDays(toDate, fromDate) > MAX_RANGE_DAYS) {
      return error(`Range too wide: at most ${MAX_RANGE_DAYS} days`);
    }
    if (!isBurnBarConfigured()) return error("BurnBar is not set up on the API", 409);

    const [burnbar, links, linkOptions] = await Promise.all([
      readBurnBar(),
      fetchClientLinks(connectionId),
      fetchLinkOptions(connectionId),
    ]);
    // No stale copy here: this response has nowhere to say the data is old.
    if (burnbar.error || !burnbar.data) return error(`Could not read BurnBar: ${burnbar.error ?? "unknown error"}`, 502);

    const listed = listEntries({ data: burnbar.data, links, linkOptions, from, to, now, timeZone: tz });
    const response: TimeEntriesResponse = { from, to, timeZone: tz, ...listed };
    return json(response);
  } catch (err) {
    return handleError(err);
  }
}
