# Floaters MCP

An [MCP](https://modelcontextprotocol.io) surface over Floaters, shared by
Claude, ChatGPT/Dot and local MCP clients. Read tools use the same cashflow,
forecast and time computations as the web app. Forecast write tools use the
existing authenticated API and its validation; they change Floaters forecasts,
not Xero accounting records. Remote connections expose all 17 read and write tools
through the same existing URL. Local stdio clients can opt into writes.
Two ways to reach them:

- **Remote (claude.ai, Claude desktop, any Streamable HTTP client)**: the API
  serves the tools at `https://floaters.flux.am/mcp/<MCP_SECRET>`. See
  "Remote setup" below.
- **Local stdio (`@floaters/mcp`, this package)**: for OpenClaw and other
  clients that spawn a process.

## Tools

| Tool | What it returns |
|---|---|
| `get_cashflow` | Monthly cashflow: income as three layers per client (paid / invoiced / projected, explicit client keys), costs by account, and two balance walks — committed (the headline, never includes hope; drives "falls below £0") and optimistic (adds unfulfilled projection remainders). Past months are pure cash. Params: `monthsBack` (max 12), `monthsForward` (max 24), and optional `excludeCost` account-code / `excludeClient` client-key arrays for temporary what-if exclusions. Exclusions recalculate totals without saving anything. |
| `get_income_pipeline` | Item-level income pipeline: projections with remainders and derived lapsed flags, unreviewed invoices awaiting triage, and known client contacts. Same client keys as `get_cashflow`. |
| `get_connection` | Connected Xero org + bank accounts + current balances. |
| `get_forecast` | Day/week/month forecast periods over a date range, optional scenario overlay. Predates the pipeline model (no projections, no overdue roll-forward). Params: `period`, `from`, `to`, `scenarioIds`. |
| `list_transactions` | Outstanding invoices/bills with amounts due and dates. Params: `type`, `status`. |
| `get_time_tracking` | Hours read live from BurnBar by client per month (same window as `get_cashflow`, nothing before January 2026), per-project breakdown, and `invoicedExVat` for clients linked to the income pipeline (effective rate = invoiced / hours). Also today's and this week's hours and the running entry. Params: `monthsBack`, `monthsForward`. |
| `list_time_entries` | Individual BurnBar entries over a date range (default last 7 days, max 92), newest first. Params: `from`, `to`. |
| `get_forecast_settings` | Saved projections, raw account/month cost overrides, hidden cost accounts and saved cost schedules/classifications. Read before changing forecasts. |

### Write tools

| Tool | Change |
|---|---|
| `create_income_projection` | Add expected income or a monthly recurring series; GBP including VAT. |
| `update_income_projection` | Replace selected fields on an existing projection. Recurrence edits affect its whole series. |
| `delete_income_projection` | Remove a projection/series, releasing linked invoices to standalone without deleting them. |
| `set_cost_override` | Set the expected total for an account/month. Known payments and bills remain the floor. |
| `remove_cost_override` | Restore automatic account/month estimation. |
| `update_invoice_forecast` | Set a local expected payment date, review status or projection assignment. Never marks an invoice paid or changes Xero. |
| `set_cost_account_hidden` | Save row visibility. Hidden costs still count in totals; use temporary exclusions for what-if removal. |
| `save_cost_forecast_rule` | Save a recurring cost schedule, mark a payment one-off, or dismiss a stream using identifiers from Floaters. |
| `remove_cost_forecast_rule` | Remove a saved cost schedule/classification and restore automatic estimation. |

Each tool has explicit read/write, destructive and idempotency annotations for
clients. These are hints, not access control: the private endpoint credential
authenticates access to all 17 tools. Read settings/pipeline before editing.
Creation is not idempotent; inspect the pipeline before retrying an uncertain
create response. There are no arbitrary HTTP, SQL, sync or connection-management
tools. Retirement balances and assumptions are not currently exposed by MCP.

## Remote setup: Claude, ChatGPT and Dot

The API exposes all read and forecast-write tools on the same stateless
Streamable HTTP endpoint:

```
https://floaters.flux.am/mcp/<MCP_SECRET>
```

Keep using the existing URL. `MCP_SECRET` must be a random value of at least 16
characters, independent of `CONNECT_SECRET`. After tool changes, refresh the
connection's tool list so clients discover the write operations. The previously
issued `MCP_WRITE_SECRET` URL remains a compatibility alias with the same tools;
new connections do not need a separate write endpoint.

In Claude: Customise → Connectors → Add → **Add custom connector**, name it
`Floaters`, and paste the URL:

```
https://floaters.flux.am/mcp/<MCP_SECRET>
```

In ChatGPT, add the same URL through
Plugins → + → Add custom MCP server, subject to account/workspace permissions.
Use the resulting enabled plugin for Dot. Choose No authentication because the
private URL itself carries access. Rescan/reconnect after changing the tool list.

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

Required env vars:

- `FLOATERS_API_URL` — base URL of the Floaters API (e.g. `https://floaters.flux.am`).
- `FLOATERS_API_KEY` — the API's `CONNECT_SECRET`.

Optional: `FLOATERS_MCP_ALLOW_WRITES=true` explicitly enables the nine write
tools for a local stdio client. Without this exact value it remains read-only.

## Build

From the monorepo root:

```bash
npm run build:mcp        # esbuild -> apps/mcp/dist
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
          "FLOATERS_API_URL": "https://floaters.flux.am",
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
  --env FLOATERS_API_URL=https://floaters.flux.am \
  --env FLOATERS_API_KEY=<your CONNECT_SECRET>
```

Then check it's registered:

```bash
openclaw mcp status
```

OpenClaw's heartbeat can now read your cash position, e.g. "what's my projected
balance in 3 months" or "which month do I dip below zero".
