import { NextRequest, NextResponse } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerFloatersTools } from "@floaters/mcp-tools";
import { mcpAccess, localApiClient } from "@/lib/mcp";

// Remote MCP endpoint (Streamable HTTP, stateless) for claude.ai and any other
// remote MCP client. Every authenticated connection exposes reads and forecast
// writes. Stateless means one server + transport per request and no
// session ids, which is what a serverless-style route handler can honour.

export const dynamic = "force-dynamic";

async function handle(request: NextRequest, context: { params: Promise<{ secret: string }> }) {
  const { secret } = await context.params;
  const access = mcpAccess(secret);
  if (!access) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const server = new McpServer({ name: "floaters", version: "1.1.0" });
  const api = localApiClient();
  registerFloatersTools(server, api.get, api.write);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } finally {
    // Stateless: nothing outlives the request.
    void transport.close().catch(() => {});
  }
}

export const POST = handle;
export const DELETE = handle;

// Stateless mode has no server-initiated stream to offer: a standalone GET
// would open an SSE response that never carries anything. Say so instead of
// holding the connection.
export async function GET(request: NextRequest, context: { params: Promise<{ secret: string }> }) {
  const { secret } = await context.params;
  if (!mcpAccess(secret)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(
    { error: "Method not allowed: this endpoint is stateless; POST JSON-RPC requests" },
    { status: 405, headers: { Allow: "POST, DELETE" } }
  );
}
