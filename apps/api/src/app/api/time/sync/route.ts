import { requireConnection, json, error, handleError, AuthError } from "@/lib/api-helpers";
import { isTogglConfigured } from "@/lib/toggl/client";
import { runTogglSync } from "@/lib/toggl/sync";
import { NextRequest } from "next/server";
import { z } from "zod/v4";

const flagsSchema = z.object({ full: z.boolean().optional() });

// POST /api/time/sync — pull clients, projects and time entries from Toggl.
// { full: true } re-walks the whole history window instead of the `since`
// cursor. The main POST /api/sync also runs this after the Xero sync when
// Toggl is configured, so Sync Now covers both.
export async function POST(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    if (!isTogglConfigured()) {
      return error("Toggl is not configured: set TOGGL_API_TOKEN on the API", 409);
    }
    const body = await request.json().catch(() => ({}));
    const parsed = flagsSchema.safeParse(body ?? {});
    const flags = parsed.success ? parsed.data : {};
    const result = await runTogglSync(connectionId, { full: flags.full === true });
    return json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AuthError) return handleError(err);
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Toggl sync failed:", message);
    return error(`Toggl sync failed: ${message}`, 502);
  }
}
