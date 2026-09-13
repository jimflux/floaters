#!/usr/bin/env node
// Floaters MCP server — read-only access to the cash flow data for OpenClaw and
// other stdio MCP clients. The tool surface lives in @floaters/mcp-tools and is
// shared with the API's remote endpoint for claude.ai; every tool is a GET
// against the Floaters API, so this server can only ever read.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerFloatersTools } from "@floaters/mcp-tools";
import { apiGet } from "./client.js";

const server = new McpServer({
  name: "floaters",
  version: "1.0.0",
});

registerFloatersTools(server, apiGet);

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
