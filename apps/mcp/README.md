# @floaters/mcp

A **read-only** [MCP](https://modelcontextprotocol.io) server that exposes the
Floaters cash flow data to OpenClaw (and any other MCP client). It's a thin
client over the Floaters API's GET endpoints, so it can only ever read — it
reuses the same cashflow/forecast computation the web app sees.

## Tools

| Tool | What it returns |
|---|---|
| `get_cashflow` | Monthly cash-in/out by account, opening/closing balances, net movement, "falls below £0" month. Past months are pure cash actuals (bank transactions + invoice payments); the current month blends cash-to-date with a projected remainder; future months are projections. Params: `monthsBack` (max 12), `monthsForward` (max 24). |
| `get_connection` | Connected Xero org + bank accounts + current balances. |
| `get_forecast` | Day/week/month forecast periods over a date range, optional scenario overlay. Params: `period`, `from`, `to`, `scenarioIds`. |
| `list_transactions` | Outstanding invoices/bills with amounts due and dates. Params: `type`, `status`. |

## Configuration

Two env vars:

- `FLOATERS_API_URL` — base URL of the Floaters API (e.g. `https://api.floaters.flux.am`).
- `FLOATERS_API_KEY` — the API's `CONNECT_SECRET`.

## Build

From the monorepo root:

```bash
npm run build:mcp        # tsc -> apps/mcp/dist
```

## Add to OpenClaw

OpenClaw reads MCP servers from `~/.openclaw/openclaw.json`. Add a stdio entry
pointing at the built server:

```json
{
  "mcp": {
    "servers": {
      "floaters": {
        "command": "node",
        "args": ["/Users/jimralley/flux-code/floaters/apps/mcp/dist/index.js"],
        "env": {
          "FLOATERS_API_URL": "https://api.floaters.flux.am",
          "FLOATERS_API_KEY": "<your CONNECT_SECRET>"
        }
      }
    }
  }
}
```

Or via the CLI:

```bash
openclaw mcp add floaters \
  --command node \
  --arg /Users/jimralley/flux-code/floaters/apps/mcp/dist/index.js \
  --env FLOATERS_API_URL=https://api.floaters.flux.am \
  --env FLOATERS_API_KEY=<your CONNECT_SECRET>
```

Then check it's registered:

```bash
openclaw mcp status
```

OpenClaw's heartbeat can now read your cash position, e.g. "what's my projected
balance in 3 months" or "which month do I dip below zero".
