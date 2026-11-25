#!/usr/bin/env node
// Floaters MCP server. Existing stdio clients remain read-only unless explicitly enabled.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerFloatersTools } from "@floaters/mcp-tools";
import { apiGet, apiWrite } from "./client.js";

const server = new McpServer({
  name: "floaters",
  version: "1.0.0",
});

registerFloatersTools(server, apiGet, process.env.FLOATERS_MCP_ALLOW_WRITES === 'true' ? apiWrite : undefined);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs go to stderr so they don't corrupt the stdio MCP protocol on stdout.
  console.error("floaters MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
