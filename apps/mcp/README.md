# Floaters MCP

A **read-only** [MCP](https://modelcontextprotocol.io) surface over the Floaters
cash flow data. The tools live in `packages/mcp-tools` and are thin GETs against
the Floaters API, so no MCP client can ever write; they reuse the same
cashflow/forecast/time computation the web app sees. Two ways to reach them:

- **Remote (claude.ai, Claude desktop, any Streamable HTTP client)**: the API
  serves the tools at `https://floaters.flux.am/mcp/<MCP_SECRET>`. See
  "Use from claude.ai" below.
- **Local stdio (`@floaters/mcp`, this package)**: for OpenClaw and other
  clients that spawn a process.

## Tools

| Tool | What it returns |
|---|---|
| `get_cashflow` | Monthly cashflow: income as three layers per client (paid / invoiced / projected, explicit client keys), costs by account, and two balance walks — committed (the headline, never includes hope; drives "falls below £0") and optimistic (adds unfulfilled projection remainders). Past months are pure cash. Params: `monthsBack` (max 12), `monthsForward` (max 24). |
| `get_income_pipeline` | Item-level income pipeline: projections with remainders and derived lapsed flags, unreviewed invoices awaiting triage, and known client contacts. Same client keys as `get_cashflow`. |
| `get_connection` | Connected Xero org + bank accounts + current balances. |
| `get_forecast` | Day/week/month forecast periods over a date range, optional scenario overlay. Predates the pipeline model (no projections, no overdue roll-forward). Params: `period`, `from`, `to`, `scenarioIds`. |
| `list_transactions` | Outstanding invoices/bills with amounts due and dates. Params: `type`, `status`. |
| `get_time_tracking` | Hours from Toggl by client per month (same window as `get_cashflow`), billable split, per-project breakdown, and `invoicedExVat` for clients linked to the income pipeline (effective rate = invoiced / hours). Also today's and this week's hours and the running entry. Params: `monthsBack`, `monthsForward`. |
| `list_time_entries` | Individual Toggl entries over a date range (default last 7 days, max 92), newest first. Params: `from`, `to`. |

## Use from claude.ai

The API exposes the same tools as a stateless Streamable HTTP MCP endpoint at
`/mcp/<MCP_SECRET>`. The secret in the path is the whole access control, so it
is a long random value set on the API (Railway env var `MCP_SECRET`, generate
with `openssl rand -hex 24`), separate from `CONNECT_SECRET`.

In claude.ai: Settings → Connectors → **Add custom connector**, name it
`Floaters`, and paste the URL:

```
https://floaters.flux.am/mcp/<MCP_SECRET>
```

No OAuth or extra credentials are needed. Once added, enable it in a chat and
ask things like "what's my cash position", "which month do I dip below zero",
or "how many hours did I do for Propellernet last month and what did I invoice
them". Rotating the secret is one env var change on Railway; the old URL then
404s.

Quick check from a shell:

```bash
curl -sS -X POST "https://floaters.flux.am/mcp/<MCP_SECRET>" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Configuration (stdio server)

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
