import { supabase } from "@/lib/supabase";
import type { XeroTokenResponse, XeroConnection } from "@/types/xero";

const XERO_TOKEN_URL = "https://login.xero.com/identity/connect/token";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";

/**
 * Custom Connection: client_credentials grant.
 * No user login needed — token is obtained directly.
 */
export async function getClientCredentialsToken(): Promise<XeroTokenResponse> {
  const credentials = Buffer.from(
    `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token request failed: ${error}`);
  }

  return response.json();
}

export async function getXeroConnections(
  accessToken: string
): Promise<XeroConnection[]> {
  const response = await fetch(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Xero connections: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get a valid access token, refreshing via client_credentials if expired.
 * Custom Connections don't use refresh tokens — just request a new token.
 */
export async function getValidAccessToken(
  connectionId: string
): Promise<{ accessToken: string; tenantId: string }> {
  const { data: conn, error } = await supabase
    .from("xero_connections")
    .select("*")
    .eq("id", connectionId)
    .single();

  if (error || !conn) {
    throw new Error("No Xero connection found");
  }

  const expiresAt = new Date(conn.token_expires_at);
  const now = new Date();
  const fiveMinutes = 5 * 60 * 1000;

  // Re-authenticate if within 5 minutes of expiry
  if (expiresAt.getTime() - now.getTime() < fiveMinutes) {
    const tokens = await getClientCredentialsToken();

    await supabase
      .from("xero_connections")
      .update({
        access_token: tokens.access_token,
        token_expires_at: new Date(
          Date.now() + tokens.expires_in * 1000
        ).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId);

    return { accessToken: tokens.access_token, tenantId: conn.tenant_id };
  }

  return { accessToken: conn.access_token, tenantId: conn.tenant_id };
}
