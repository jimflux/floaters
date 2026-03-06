import { supabase } from "@/lib/supabase";
import type { XeroTokenResponse, XeroConnection } from "@/types/xero";

const XERO_AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://login.xero.com/identity/connect/token";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";

const SCOPES = [
  "openid",
  "profile",
  "email",
  "accounting.transactions.read",
  "accounting.contacts.read",
  "accounting.settings.read",
  "accounting.reports.read",
].join(" ");

export function getAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.XERO_CLIENT_ID!,
    redirect_uri: process.env.XERO_REDIRECT_URI!,
    scope: SCOPES,
    state,
  });

  return `${XERO_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  code: string
): Promise<XeroTokenResponse> {
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
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.XERO_REDIRECT_URI!,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<XeroTokenResponse> {
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
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
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

  // Refresh if within 5 minutes of expiry
  if (expiresAt.getTime() - now.getTime() < fiveMinutes) {
    const tokens = await refreshAccessToken(conn.refresh_token);

    await supabase
      .from("xero_connections")
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
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
