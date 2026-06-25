#!/usr/bin/env node
// Floaters MCP server — read-only access to the cash flow data for OpenClaw and
// other MCP clients. Transport: stdio. Every tool is a GET against the Floaters
// API, so this server can only ever read.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiGet } from "./client.js";

const server = new McpServer({
  name: "floaters",
  version: "1.0.0",
});

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown): ToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

server.registerTool(
  "get_cashflow",
  {
    title: "Get cash flow",
    description:
      "Monthly cash-in and cash-out grouped by Xero chart-of-accounts, with opening/closing bank balances, net movement, and the month the balance is projected to fall below zero. Past months are actuals; future months are projections (3-month average for costs, outstanding invoices for income) plus any manual overrides.",
    inputSchema: {
      monthsBack: z
        .number()
        .int()
        .min(0)
        .max(24)
        .optional()
        .describe("Historical months to include (default 3)."),
      monthsForward: z
        .number()
        .int()
        .min(1)
        .max(36)
        .optional()
        .describe("Projected months to include (default 12)."),
    },
  },
  async ({ monthsBack, monthsForward }) => {
    try {
      return ok(
        await apiGet("/api/cashflow", { back: monthsBack, forward: monthsForward })
      );
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "get_connection",
  {
    title: "Get connection & balances",
    description:
      "The connected Xero organisation, its bank accounts, and current balances (total and per account).",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await apiGet("/api/connection"));
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "get_forecast",
  {
    title: "Get cash flow forecast",
    description:
      "Day/week/month forecast periods with opening, inflows, outflows and closing balance over a date range, optionally overlaying what-if scenarios.",
    inputSchema: {
      period: z
        .enum(["daily", "weekly", "monthly"])
        .optional()
        .describe("Aggregation period (default weekly)."),
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Start date YYYY-MM-DD (default today)."),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("End date YYYY-MM-DD (default 3 months out)."),
      scenarioIds: z
        .array(z.string())
        .optional()
        .describe("Scenario IDs to overlay."),
    },
  },
  async ({ period, from, to, scenarioIds }) => {
    try {
      return ok(
        await apiGet("/api/forecast", {
          period,
          from,
          to,
          scenarios: scenarioIds?.join(","),
        })
      );
    } catch (err) {
      return fail(err);
    }
  }
);

server.registerTool(
  "list_transactions",
  {
    title: "List outstanding invoices & bills",
    description:
      "Outstanding invoices (ACCREC) and bills (ACCPAY) with amounts due, due dates and any expected payment date overrides.",
    inputSchema: {
      type: z
        .enum(["ACCREC", "ACCPAY"])
        .optional()
        .describe("ACCREC = invoices owed to you, ACCPAY = bills you owe."),
      status: z
        .string()
        .optional()
        .describe("Filter by Xero status (default AUTHORISED/SUBMITTED/DRAFT)."),
    },
  },
  async ({ type, status }) => {
    try {
      return ok(await apiGet("/api/transactions", { type, status }));
    } catch (err) {
      return fail(err);
    }
  }
);

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
