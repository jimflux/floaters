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
      "Monthly cashflow with income as a pipeline rolled up by client and costs grouped by Xero chart-of-accounts. Income has three layers per client per month: paid (cash received), invoiced (promises: remaining amount due, overdue rolled into the current month and flagged), and projected (unfulfilled projection remainders at their expected month). Client keys are explicit ('contact:<id>', 'label:<normalised>', or 'UNASSIGNED' for non-invoice income). Two balance walks: committed (cash plus invoices sent plus cost forecasts; the headline, so fallsBelowZeroIn reads this and never includes hope) and optimistic (committed plus projection remainders; optimisticFallsBelowZeroIn). Both are identical over history. Past months are pure cash; the current month blends cash-to-date with a projected remainder; costs use bills by expected/due date, manual overrides, then a 3-month average. Note: get_forecast uses a separate engine that predates the pipeline model.",
    inputSchema: {
      monthsBack: z
        .number()
        .int()
        .min(0)
        .max(12)
        .optional()
        .describe("Historical months to include (default 3, max 12, the synced history depth)."),
      monthsForward: z
        .number()
        .int()
        .min(1)
        .max(24)
        .optional()
        .describe("Projected months to include (default 12, max 24)."),
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
  "get_income_pipeline",
  {
    title: "Get income pipeline",
    description:
      "Item-level view of the income pipeline: projections (client key as used by get_cashflow, VAT-inclusive amount, expected month, remainder after assigned invoices, derived lapsed flag, assigned invoice ids), unreviewed invoices awaiting triage (with overdue flags), and the known client contacts. Lapsed projections are hope whose expected month passed unfulfilled; they are excluded from the optimistic balance line until re-dated or deleted.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await apiGet("/api/pipeline"));
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
      "Day/week/month forecast periods with opening, inflows, outflows and closing balance over a date range, optionally overlaying what-if scenarios. Uses a separate engine that predates the income pipeline: overdue invoices are not rolled forward and income projections are not included, so it can disagree with get_cashflow's committed series.",
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
