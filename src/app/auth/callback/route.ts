import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, getXeroConnections } from "@/lib/xero/auth";
import { createSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { runSync } from "@/lib/xero/sync";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      `${process.env.FRONTEND_URL}?error=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${process.env.FRONTEND_URL}?error=missing_code`
    );
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);

    // Get Xero tenant info
    const connections = await getXeroConnections(tokens.access_token);
    if (connections.length === 0) {
      return NextResponse.redirect(
        `${process.env.FRONTEND_URL}?error=no_xero_org`
      );
    }

    const tenant = connections[0]; // Use first connected org

    // Upsert connection
    const { data: conn, error: dbError } = await supabase
      .from("xero_connections")
      .upsert(
        {
          tenant_id: tenant.tenantId,
          tenant_name: tenant.tenantName,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: new Date(
            Date.now() + tokens.expires_in * 1000
          ).toISOString(),
          scopes: tokens.scope.split(" "),
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

    // Trigger initial sync in background (don't await)
    runSync(conn.id, true).catch((err) =>
      console.error("Initial sync failed:", err)
    );

    return NextResponse.redirect(
      `${process.env.FRONTEND_URL}/dashboard`
    );
  } catch (err) {
    console.error("OAuth callback error:", err);
    return NextResponse.redirect(
      `${process.env.FRONTEND_URL}?error=auth_failed`
    );
  }
}
