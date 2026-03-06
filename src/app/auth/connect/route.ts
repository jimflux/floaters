import { NextResponse } from "next/server";
import { getClientCredentialsToken, getXeroConnections } from "@/lib/xero/auth";
import { createSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { runSync } from "@/lib/xero/sync";

/**
 * Custom Connection auth: no user redirect needed.
 * Requests a token via client_credentials, fetches the connected tenant,
 * stores the connection, creates a session, and triggers initial sync.
 */
export async function GET() {
  try {
    // Get token via client credentials
    const tokens = await getClientCredentialsToken();

    // Get connected tenant
    const connections = await getXeroConnections(tokens.access_token);
    if (connections.length === 0) {
      return NextResponse.json(
        { error: "No Xero organisation connected. Set up the Custom Connection in Xero first." },
        { status: 400 }
      );
    }

    const tenant = connections[0];

    // Upsert connection (no refresh token for custom connections)
    const { data: conn, error: dbError } = await supabase
      .from("xero_connections")
      .upsert(
        {
          tenant_id: tenant.tenantId,
          tenant_name: tenant.tenantName,
          access_token: tokens.access_token,
          refresh_token: "custom_connection",
          token_expires_at: new Date(
            Date.now() + tokens.expires_in * 1000
          ).toISOString(),
          scopes: tokens.scope ? tokens.scope.split(" ") : [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id" }
      )
      .select()
      .single();

    if (dbError || !conn) {
      throw new Error(`Failed to store connection: ${dbError?.message}`);
    }

    // Create session
    await createSession({
      connectionId: conn.id,
      tenantId: tenant.tenantId,
    });

    // Trigger initial sync in background
    runSync(conn.id, true).catch((err) =>
      console.error("Initial sync failed:", err)
    );

    // Redirect to frontend
    return NextResponse.redirect(
      `${process.env.FRONTEND_URL}/dashboard`
    );
  } catch (err) {
    console.error("Connect error:", err);
    return NextResponse.json(
      { error: "Failed to connect to Xero", details: String(err) },
      { status: 500 }
    );
  }
}
