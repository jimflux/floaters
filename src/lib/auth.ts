import { headers } from "next/headers";
import { supabase } from "./supabase";

/**
 * Single-user auth via API key in Authorization header.
 * Frontend sends: Authorization: Bearer <CONNECT_SECRET>
 * No cookies, no JWT, no cross-domain issues.
 */
export async function getConnectionId(): Promise<string | null> {
  const headerStore = await headers();
  const authHeader = headerStore.get("authorization");

  if (!authHeader?.startsWith("Bearer ")) return null;
  const apiKey = authHeader.slice(7);

  if (apiKey !== process.env.CONNECT_SECRET) return null;

  const { data } = await supabase
    .from("xero_connections")
    .select("id")
    .limit(1)
    .single();

  return data?.id || null;
}
