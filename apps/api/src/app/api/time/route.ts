import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import { format, addMonths, subMonths, startOfMonth } from "date-fns";
import { z } from "zod/v4";
import { HISTORY_MONTHS } from "@/lib/xero/sync";
import { HOURS_TIME_ZONE, isBurnBarConfigured, loadBurnBar, readBurnBar } from "@/lib/hours/burnbar";
import { rollupTime } from "@/lib/hours/rollup";
import { fetchClientLinks, fetchLinkOptions, fetchInvoicedByClientMonth, saveClientLink } from "@/lib/hours/store";
import type { TimeTrackingResponse } from "@/types/api";

// Hours by BurnBar client per month over the same window as the cashflow grid,
// read live from BurnBar. Context, not cash: nothing here touches the balance
// walks. Hours before January 2026 are never shown.

const querySchema = z.object({
  back: z.coerce.number().int().min(0).max(HISTORY_MONTHS).default(3),
  forward: z.coerce.number().int().min(1).max(24).default(12),
  // fresh=1 skips the one-minute memory copy (the panel's Refresh button).
  fresh: z.enum(["0", "1"]).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      back: searchParams.get("back") ?? undefined,
      forward: searchParams.get("forward") ?? undefined,
      fresh: searchParams.get("fresh") ?? undefined,
    });
    if (!parsed.success) {
      return error(`Invalid window: back must be 0-${HISTORY_MONTHS}, forward must be 1-24`);
    }
    const { back, forward, fresh } = parsed.data;

    const now = new Date();
    const thisMonth = startOfMonth(now);
    const from = subMonths(thisMonth, back);
    const to = addMonths(thisMonth, forward);
    const months: string[] = [];
    for (let cursor = from; cursor < to; cursor = addMonths(cursor, 1)) {
      months.push(format(cursor, "yyyy-MM"));
    }
    const currentMonthIndex = months.indexOf(format(thisMonth, "yyyy-MM"));

    const configured = isBurnBarConfigured();
    const [burnbar, links, linkOptions, invoiced] = await Promise.all([
      configured ? readBurnBar({ fresh: fresh === "1" }) : Promise.resolve({ data: null, error: null }),
      fetchClientLinks(connectionId),
      fetchLinkOptions(connectionId),
      fetchInvoicedByClientMonth(connectionId, format(from, "yyyy-MM-dd")),
    ]);

    const rollup = rollupTime({
      clients: burnbar.data?.clients ?? [],
      projects: burnbar.data?.projects ?? [],
      entries: burnbar.data?.entries ?? [],
      links,
      months,
      now,
      timeZone: HOURS_TIME_ZONE,
      linkOptions,
      invoicedByClientMonth: invoiced,
    });

    const response: TimeTrackingResponse = {
      configured,
      lastSyncedAt: burnbar.data?.fetchedAt ?? null,
      syncStatus: burnbar.error ? "error" : "idle",
      syncError: burnbar.error,
      timeZone: HOURS_TIME_ZONE,
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

// Link (or unlink) a BurnBar client to a pipeline client key. null clears the
// explicit link, falling back to the name match. The field keeps its Toggl-era
// name so the web and MCP contract is unchanged.
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

    if (!isBurnBarConfigured()) return error("BurnBar is not set up on the API", 409);
    let clients;
    try {
      clients = (await loadBurnBar()).clients;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return error(`Could not read BurnBar: ${message}`, 502);
    }
    const client = clients.find((c) => c.id === togglClientId);
    if (!client) return error("Unknown BurnBar client", 404);

    const { error: dbError } = await saveClientLink(connectionId, client, clientKey);
    if (dbError) return error(`Failed to update link: ${dbError}`, 500);
    return json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
