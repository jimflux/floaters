import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { supabase } from "@/lib/supabase";
import { NextRequest } from "next/server";
import { format, addMonths, subMonths, startOfMonth, subDays } from "date-fns";
import { z } from "zod/v4";
import { HISTORY_MONTHS } from "@/lib/xero/sync";
import { isTogglConfigured, togglTimeZone } from "@/lib/toggl/client";
import { rollupTime } from "@/lib/toggl/rollup";
import {
  fetchEntries,
  fetchProjects,
  fetchClients,
  fetchState,
  fetchLinkOptions,
  fetchInvoicedByClientMonth,
} from "@/lib/toggl/store";
import type { TimeTrackingResponse } from "@/types/api";

// Hours by Toggl client per month over the same window as the cashflow grid.
// Context, not cash: nothing here touches the balance walks.

const querySchema = z.object({
  back: z.coerce.number().int().min(0).max(HISTORY_MONTHS).default(3),
  forward: z.coerce.number().int().min(1).max(24).default(12),
});

export async function GET(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      back: searchParams.get("back") ?? undefined,
      forward: searchParams.get("forward") ?? undefined,
    });
    if (!parsed.success) {
      return error(`Invalid window: back must be 0-${HISTORY_MONTHS}, forward must be 1-24`);
    }
    const { back, forward } = parsed.data;

    const now = new Date();
    const thisMonth = startOfMonth(now);
    const from = subMonths(thisMonth, back);
    const to = addMonths(thisMonth, forward);
    const months: string[] = [];
    for (let cursor = from; cursor < to; cursor = addMonths(cursor, 1)) {
      months.push(format(cursor, "yyyy-MM"));
    }
    const currentMonthIndex = months.indexOf(format(thisMonth, "yyyy-MM"));

    // A day of slack on the window start so a late-evening local entry that
    // is the previous UTC day still buckets correctly.
    const entriesFrom = subDays(from, 1).toISOString();
    const [state, entries, projects, clients, linkOptions, invoiced] = await Promise.all([
      fetchState(connectionId),
      fetchEntries(connectionId, entriesFrom),
      fetchProjects(connectionId),
      fetchClients(connectionId),
      fetchLinkOptions(connectionId),
      fetchInvoicedByClientMonth(connectionId, format(from, "yyyy-MM-dd")),
    ]);

    const tz = togglTimeZone();
    const rollup = rollupTime({
      entries,
      projects,
      clients,
      months,
      now,
      timeZone: tz,
      linkOptions,
      invoicedByClientMonth: invoiced,
    });

    const response: TimeTrackingResponse = {
      configured: isTogglConfigured(),
      lastSyncedAt: state?.last_synced_at ?? null,
      syncStatus: state?.sync_status ?? "idle",
      syncError: state?.sync_error ?? null,
      timeZone: tz,
      months,
      currentMonthIndex,
      clients: rollup.clients,
      totals: rollup.totals,
      todayHours: rollup.todayHours,
      weekHours: rollup.weekHours,
      running: rollup.running,
      linkOptions,
    };
    return json(response);
  } catch (err) {
    return handleError(err);
  }
}

// Link (or unlink) a Toggl client to a pipeline client key. null clears the
// explicit link, falling back to the name match.
const patchSchema = z.object({
  togglClientId: z.number().int().positive(),
  clientKey: z.string().min(1).nullable(),
});

export async function PATCH(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const body = await request.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body ?? {});
    if (!parsed.success) return error("Invalid link: togglClientId and clientKey (or null) required", 400);
    const { togglClientId, clientKey } = parsed.data;

    const { data, error: dbError } = await supabase
      .from("toggl_clients")
      .update({ client_key: clientKey, updated_at: new Date().toISOString() })
      .eq("connection_id", connectionId)
      .eq("toggl_id", togglClientId)
      .select("toggl_id");
    if (dbError) return error(`Failed to update link: ${dbError.message}`, 500);
    if (!data || data.length === 0) return error("Unknown Toggl client; sync first", 404);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
