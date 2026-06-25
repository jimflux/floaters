import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { runSync } from "@/lib/xero/sync";

export async function POST() {
  try {
    const connectionId = await requireConnection();

    // Check if already syncing
    const { data: conn } = await supabase
      .from("xero_connections")
      .select("sync_status")
      .eq("id", connectionId)
      .single();

    if (conn?.sync_status === "syncing") {
      return error("Sync already in progress", 409);
    }

    // Run sync in background
    runSync(connectionId).catch((err) =>
      console.error("Manual sync failed:", err)
    );

    return json({ message: "Sync started" }, 202);
  } catch (err) {
    return handleError(err);
  }
}
