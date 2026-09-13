# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A cash flow forecasting app (clone of Float's cash flow tab) for a single user (Jim). Connects to Xero to sync financial data and projects cash flow forward. GBP primary currency.

Originally two repos (a Next.js API + a Lovable-built frontend); now a single npm-workspaces monorepo.

## Monorepo layout

```
apps/api      Next.js API (App Router, API routes only) — Xero sync + cashflow engine
apps/web      Vite + React 19 + shadcn/ui frontend (was the Lovable app)
apps/mcp      Read-only MCP server exposing the cashflow data to OpenClaw
packages/types Shared API contract (the cashflow response shape) imported by all apps
```

Run from the root:

```bash
npm install            # installs all workspaces
npm run dev:api        # Next dev server (port 3000)
npm run dev:web        # Vite dev server (port 8080)
npm run build:api      # production build of the API
npm run build:web      # production build of the web app
npm run build:mcp      # esbuild the MCP server to apps/mcp/dist
npm test               # run every workspace's tests
```

## Stack

- **Next.js 16** (App Router) — API routes only, no pages (`apps/api`)
- **React 19** + Vite + Tailwind + shadcn/ui (`apps/web`)
- **TypeScript** strict mode everywhere
- **Supabase** (Postgres) via the service role key, RLS on (only service role bypasses it)
- **Xero API** — OAuth 2.0 Web app flow (auth code, not PKCE)
- **MCP** via `@modelcontextprotocol/sdk` (`apps/mcp`)

## API architecture (`apps/api`)

### Auth
Single-user API-key auth: the web app and MCP server send `Authorization: Bearer <CONNECT_SECRET>`. `getConnectionId()` in `src/lib/auth.ts` checks the key and returns the one connection's id. (The older Xero-OAuth login flow under `src/app/auth/` still exists for connecting Xero.)

### Xero Sync
`src/lib/xero/sync.ts` — initial + incremental sync, rate-limited to ~54 calls/min via `bottleneck`. Syncs accounts, invoices (ACCREC/ACCPAY), bank transactions, and invoice payments (`xero_payments` — payments are NOT bank transactions in Xero). Incremental invoice syncs include PAID/VOIDED/DELETED status transitions; `POST /api/sync` accepts `{ heal: true }` to re-fetch locally-open invoices by ID. Writes via **batched** `chunkedUpsert()` (500-row chunks) on `(connection_id, xero_id)`. Token refresh is automatic in `src/lib/xero/auth.ts`.

### Forecast / cashflow
- `src/lib/forecast/engine.ts` — `computeForecast()` projects daily flows from invoice/bill due (or `expected_payment_date`) dates, overlays scenario items, aggregates by period. `getOccurrences()` expands recurrence.
- `src/app/api/cashflow/route.ts` — the main dashboard endpoint. **Income is a pipeline rolled up by client** (not account rows): three layers per client per month — paid (whole ACCREC payment amounts plus non-invoice income), invoiced (remaining `amount_due` of open ACCREC invoices at `expected_payment_date || due_date`, overdue floored to the current month and flagged), projected (unfulfilled `income_projections` remainders at their expected month; lapse is derived, never stored). Client keys are explicit (`contact:<id>` / `label:<normalised>` / `UNASSIGNED`); shared semantics live in `src/lib/pipeline.ts`. **Costs keep the account model**: past = signed cash scaled to tax-inclusive totals, current month blends cash-to-date with a remainder (bills win by presence, then `projection_overrides`, then the 3-month cost average — overrides are costs-only since the pipeline cutover). Two balance walks anchored on today's bank balance: committed (cash + invoices sent + cost forecasts; drives `fallsBelowZeroIn`) and optimistic (committed + projection remainders); identical over history. Known limitation: an invoice settled by credit note clears the invoiced layer with no paid-layer cash, and its total still consumes its projection's remainder, so a credit-noted chain can bypass the lapse signal.
- **VAT** (`src/lib/vat.ts`, standard accrual, output VAT only): off unless `vat_state.enabled` (per-connection dark-launch flag). When on, output VAT accrues by quarter (ends May/Aug/Nov/Feb, paid ~1mo+7d after) from real `xero_invoices.total_tax` (issued invoices) and 20% of VATable clients' projection remainders. Issued VAT reduces committed; projected VAT reduces only optimistic. A display-only `VAT_LIABILITY` cost row shows the bill: its `monthly` carries the committed (issued-only) bill, and `vatProjectedBill` carries the issued + projected bill that the web swaps into the row on the projected view (so a future all-projected quarter reads its bill, not £0). `vatOwedNow` and `vatAdjustedClosing` (committed − running liability) stay issued-only. VATable is a per-client property (`vatable_clients`, keyed on `clientKey()`; seeded from invoice tax, unknown defaults VATable). Migrations 010 (`total_tax`) + 011 (`vatable_clients`, `vat_state`) must be applied and the tax backfilled (`POST /api/sync {backfillTax:true}`) before enabling.

### Time tracking (Toggl)
Hours are context, never cash: nothing under `src/lib/toggl/` touches either balance walk. Configured by `TOGGL_API_TOKEN` on the API (optional `TOGGL_WORKSPACE_ID`, `TOGGL_TIMEZONE`, default `Europe/London`); the token is env only, never stored. `src/lib/toggl/sync.ts` pulls clients, projects and time entries into `toggl_clients` / `toggl_projects` / `toggl_time_entries` (+ `toggl_state`): a full sync pulls history older than three months from the Reports API v3 (one paginated search, small hourly quota) and the last three months month by month from v9 (which rejects `start_date` earlier than that), incremental syncs use Toggl's `since` cursor (which returns deletions, kept as `deleted_at`), and a running entry is stored with `duration_seconds = null` and timed live at read. `POST /api/sync` runs the Toggl sync after Xero when configured (a Toggl failure is reported in the response, never fails the Xero sync); `POST /api/time/sync` runs it alone. `GET /api/time` rolls hours up by Toggl client per month over the cashflow window (`src/lib/toggl/rollup.ts`, pure): entries bucket by their local start day; each Toggl client resolves to a pipeline `clientKey` (explicit link in `toggl_clients.client_key`, a local column omitted from sync upserts, else a normalised-name match), and linked clients carry `invoicedExVat` by issue month so the web can show an effective £/hr. `PATCH /api/time` sets or clears a link; `GET /api/time/entries` lists raw entries for a date range. Migration 012.

### Conventions
- Routes return JSON via `json()` / `error()` from `src/lib/api-helpers.ts`, which set **`Cache-Control: no-store`** (this is a live financial read — never cache it).
- Request validation uses Zod v4 (`zod/v4`).
- Supabase client is a lazy Proxy (`src/lib/supabase.ts`) to avoid build-time env errors.
- `src/middleware.ts` handles CORS for the web origins.

### Database
Key tables: `xero_connections`, `xero_invoices` (carries local columns `expected_payment_date`, `projection_id`, `reviewed_at` — omitted from sync upserts so they survive re-sync), `xero_payments`, `xero_bank_transactions`, `xero_accounts`, `income_projections`, `scenarios`, `scenario_items`, `budgets`, `budget_lines`, `cash_thresholds`, `account_groups`, `hidden_accounts`, `projection_overrides` (costs only since the pipeline cutover), `sync_log`, `toggl_state`, `toggl_clients` (local `client_key` link), `toggl_projects`, `toggl_time_entries`. Migrations in `apps/api/supabase/migrations/`.

## Web app (`apps/web`)

React Query for data; the cashflow query is `['cashflow']`, hours are `['time']` (an "Hours" section under the grid plus `TimePanel` for sync and client links). Editable projection cells (`src/components/EditableCell.tsx`) use the optimistic-mutation pattern (patch in `onMutate`, roll back in `onError`, invalidate in `onSettled`). API base/key come from `VITE_API_URL` / `VITE_API_KEY`.

## MCP server (`apps/mcp`)

Read-only. Tools (`get_cashflow`, `get_income_pipeline`, `get_connection`, `get_forecast`, `list_transactions`, `get_time_tracking`, `list_time_entries`) are GETs against the API, so the server can't mutate anything. Config: `FLOATERS_API_URL` + `FLOATERS_API_KEY`. See `apps/mcp/README.md` for the OpenClaw setup.

## Deployment

API → Railway (always-on; `railway.json` at the root). See `docs/DEPLOY-RAILWAY.md` for the migration runbook (env vars, Xero redirect, DNS).

## Environment Variables

API (`apps/api/.env`): `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` / `XERO_REDIRECT_URI`, `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `CONNECT_SECRET`, `FRONTEND_URL`, `TOGGL_API_TOKEN` (optional; enables time tracking), `TOGGL_WORKSPACE_ID` / `TOGGL_TIMEZONE` (optional).
Web (`apps/web/.env`): `VITE_API_URL`, `VITE_API_KEY`.
MCP: `FLOATERS_API_URL`, `FLOATERS_API_KEY`.
