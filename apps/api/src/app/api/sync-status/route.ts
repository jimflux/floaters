import { supabase } from "@/lib/supabase";
import { requireConnection, json, handleError } from "@/lib/api-helpers";
import type { SyncStatusResponse } from "@/types/api";

export async function GET() {
  try {
    const connectionId = await requireConnection();

    const { data: conn } = await supabase
      .from("xero_connections")
      .select("sync_status, last_synced_at, sync_error")
      .eq("id", connectionId)
      .single();

    const { data: lastLog } = await supabase
      .from("sync_log")
      .select("records_synced")
      .eq("connection_id", connectionId)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    const response: SyncStatusResponse = {
      status: (conn?.sync_status as SyncStatusResponse["status"]) || "idle",
      lastSyncedAt: conn?.last_synced_at || null,
      error: conn?.sync_error || null,
      recordsSynced: lastLog?.records_synced || null,
    };

    return json(response);
  } catch (err) {
    return handleError(err);
  }
}
