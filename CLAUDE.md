# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A cash flow forecasting app (clone of Float's cash flow tab) for a single user (Jim). Connects to Xero to sync financial data and projects cash flow forward. GBP primary currency.

Originally two repos (a Next.js API + a Lovable-built frontend); now a single npm-workspaces monorepo.

## Monorepo layout

```
apps/api      Next.js API (App Router, API routes only) — Xero sync + cashflow engine
apps/web      Vite + React 19 + shadcn/ui frontend (was the Lovable app)
apps/mcp      Read-only stdio MCP server exposing the cashflow data to OpenClaw
packages/types Shared API contract (the cashflow response shape) imported by all apps
packages/mcp-tools MCP tool definitions shared by apps/mcp and the API's remote /mcp endpoint
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
Single user, two ways in, both checked by `authenticate()` in `src/lib/auth.ts` (`requireConnection()` returns the one connection's id):
- **API key**: `Authorization: Bearer <CONNECT_SECRET>`, compared in constant time. Used by the MCP server, scripts and the remote MCP endpoint's loopback calls. Never given to the web app.
- **login.flux.am session** (the web app): login.flux.am redirects to `GET /auth/callback?code=…&next=…`; the code is verified with `src/lib/flux-session.js` (a byte-for-byte copy of login.flux.am's, keep it identical) and `FLUX_LOGIN_SECRET` (`typ: 'code'`, `aud` = this host, single-use `n`), then the host-only `__Host-floaters_session` cookie is set for 30 days and the browser goes to `next` (local paths only). `GET /auth/logout` clears it and goes to `https://login.flux.am/logout`. Without `FLUX_LOGIN_SECRET` only the API key works.
- A cookie-authenticated request must also send `X-Floaters-Client: web` and, if it has an Origin, it must be this site (other flux.am subdomains are third-party hosted and count as same-site). Otherwise 403. There is no CORS: the web app is same-origin.
- Xero connects as a Custom Connection via `/auth/connect?secret=<CONNECT_SECRET>`; there is no Xero redirect callback.

### Xero Sync
`src/lib/xero/sync.ts` — initial + incremental sync, rate-limited to ~54 calls/min via `bottleneck`. Syncs accounts, invoices (ACCREC/ACCPAY), bank transactions, and invoice payments (`xero_payments` — payments are NOT bank transactions in Xero). Incremental invoice syncs include PAID/VOIDED/DELETED status transitions; `POST /api/sync` accepts `{ heal: true }` to re-fetch locally-open invoices by ID. Writes via **batched** `chunkedUpsert()` (500-row chunks) on `(connection_id, xero_id)`. Token refresh is automatic in `src/lib/xero/auth.ts`.

### Forecast / cashflow
- `src/lib/forecast/engine.ts` — `computeForecast()` projects daily flows from invoice/bill due (or `expected_payment_date`) dates, overlays scenario items, aggregates by period. `getOccurrences()` expands recurrence.
- `src/app/api/cashflow/route.ts` — the main dashboard endpoint. **Income is a pipeline rolled up by client** (not account rows): three layers per client per month — paid (whole ACCREC payment amounts plus non-invoice income), invoiced (remaining `amount_due` of open ACCREC invoices at `expected_payment_date || due_date`, overdue floored to the current month and flagged), projected (unfulfilled `income_projections` remainders at their expected month; lapse is derived, never stored). Client keys are explicit (`contact:<id>` / `label:<normalised>` / `UNASSIGNED`); shared semantics live in `src/lib/pipeline.ts`. **Costs keep the account model**: past = signed cash scaled to tax-inclusive totals, current month blends cash-to-date with a remainder (bills win by presence, then `projection_overrides`, then the 3-month cost average — overrides are costs-only since the pipeline cutover). Two balance walks anchored on today's bank balance: committed (cash + invoices sent + cost forecasts; drives `fallsBelowZeroIn`) and optimistic (committed + projection remainders); identical over history. Known limitation: an invoice settled by credit note clears the invoiced layer with no paid-layer cash, and its total still consumes its projection's remainder, so a credit-noted chain can bypass the lapse signal.
- **VAT** (`src/lib/vat.ts`, standard accrual, output VAT only): off unless `vat_state.enabled` (per-connection dark-launch flag). When on, output VAT accrues by quarter (ends May/Aug/Nov/Feb, paid ~1mo+7d after) from real `xero_invoices.total_tax` (issued invoices) and 20% of VATable clients' projection remainders. Issued VAT reduces committed; projected VAT reduces only optimistic. A display-only `VAT_LIABILITY` cost row shows the bill: its `monthly` carries the committed (issued-only) bill, and `vatProjectedBill` carries the issued + projected bill that the web swaps into the row on the projected view (so a future all-projected quarter reads its bill, not £0). `vatOwedNow` and `vatAdjustedClosing` (committed − running liability) stay issued-only. VATable is a per-client property (`vatable_clients`, keyed on `clientKey()`; seeded from invoice tax, unknown defaults VATable). Migrations 010 (`total_tax`) + 011 (`vatable_clients`, `vat_state`) must be applied and the tax backfilled (`POST /api/sync {backfillTax:true}`) before enabling.

### Time tracking (BurnBar)
Hours are context, never cash: nothing under `src/lib/hours/` touches either balance walk. Hours come only from BurnBar (Jim's own time tracker, https://burn.flux.am, repo `jimflux/burnbar`, contract in its `docs/SYNC.md`), starting January 2026: nothing earlier is read or shown. Configured by `BURNBAR_URL` and `BURNBAR_READ_TOKEN` (BurnBar's read-only bearer key, GET only) on the API; both env only, never stored. Without them `GET /api/time` returns `configured: false` and the web says BurnBar isn't set up.

BurnBar is read live, not copied into Supabase: `src/lib/hours/burnbar.ts` fetches `GET /api/state` (clients and projects, plus `hidden` archived or deleted ones so old entries keep their names) and `GET /api/entries` from 2026-01-01 to now, in windows of at most 400 days, and keeps the result in memory for 60 s (concurrent requests share one read; `GET /api/time?fresh=1`, the panel's Refresh, skips the copy). A failed read returns the last good copy with `syncStatus: "error"` and `syncError`; `lastSyncedAt` is when BurnBar was last read. `GET /api/time` rolls hours up by BurnBar client per month over the cashflow window (`src/lib/hours/rollup.ts`, pure): entries bucket by their local start day in Europe/London; a running entry (`end: null`, several can run) is timed live, and the latest started is `running`. An entry carries `clientId` only when it has no project; otherwise the client comes from the project. Each client resolves to a pipeline `clientKey` (explicit link, else a normalised-name match), and linked clients carry `invoicedExVat` by issue month so the web can show an effective £/hr. BurnBar has no billable flag or rates, so billable hours are zero and `rate` is null. `PATCH /api/time` sets or clears a link; `GET /api/time/entries` lists entries for a date range.

The response shapes keep their Toggl-era field names (`togglClientId`, `togglProjectId`, `togglId`) so the web and MCP contract did not change; they hold BurnBar ids (entry ids are UUID strings). Links reuse the Toggl table `toggl_clients` (migration 012): `PATCH` upserts a row per BurnBar client id (`toggl_id`, plus `name` and `client_key`). BurnBar kept the Toggl client ids (e.g. 68438745 Propellernet), so links made in the Toggl days still apply; newer BurnBar ids start at 1e10 or 2e10. Toggl is retired: no Toggl calls remain, and `POST /api/sync` is Xero only. The other Toggl tables (`toggl_state`, `toggl_projects`, `toggl_time_entries`) are no longer read; they can be dropped in a later migration.

### Conventions
- Routes return JSON via `json()` / `error()` from `src/lib/api-helpers.ts`, which set **`Cache-Control: no-store`** (this is a live financial read — never cache it).
- Request validation uses Zod v4 (`zod/v4`).
- Supabase client is a lazy Proxy (`src/lib/supabase.ts`) to avoid build-time env errors.

### Database
Key tables: `xero_connections`, `xero_invoices` (carries local columns `expected_payment_date`, `projection_id`, `reviewed_at` — omitted from sync upserts so they survive re-sync), `xero_payments`, `xero_bank_transactions`, `xero_accounts`, `income_projections`, `scenarios`, `scenario_items`, `budgets`, `budget_lines`, `cash_thresholds`, `account_groups`, `hidden_accounts`, `projection_overrides` (costs only since the pipeline cutover), `sync_log`, `toggl_clients` (BurnBar client links in `client_key`; the other `toggl_*` tables are unused since BurnBar). Migrations in `apps/api/supabase/migrations/`.

## Web app (`apps/web`)

React Query for data; the cashflow query is `['cashflow']`, hours are `['time']` (an "Hours" section under the grid plus `TimePanel` for refresh and client links). Editable projection cells (`src/components/EditableCell.tsx`) use the optimistic-mutation pattern (patch in `onMutate`, roll back in `onError`, invalidate in `onSettled`). Requests are same-origin with the session cookie and `X-Floaters-Client: web` (`src/lib/api.ts`); a 401 sends the browser to login.flux.am (`src/lib/session.ts`, with a one-minute loop guard in sessionStorage). Local dev: Vite proxies `/api` and `/auth` to `FLOATERS_DEV_API_URL` (default `http://localhost:3000`) and, if `FLOATERS_DEV_API_KEY` is set, adds the API key in the proxy (never in the bundle).

## MCP (`packages/mcp-tools`, `apps/mcp`, `/mcp/<secret>`)

Read-only. The tool definitions (`get_cashflow`, `get_income_pipeline`, `get_connection`, `get_forecast`, `list_transactions`, `get_time_tracking`, `list_time_entries`) live in `packages/mcp-tools` (`registerFloatersTools(server, apiGet)`) and are GETs against the API, so no MCP client can mutate anything. Two transports share them:
- `apps/mcp`: stdio server for OpenClaw. Config: `FLOATERS_API_URL` + `FLOATERS_API_KEY`. esbuild bundles the shared package (only the SDK and zod stay external).
- `apps/api/src/app/mcp/[secret]/route.ts`: remote Streamable HTTP endpoint (stateless, JSON responses) for claude.ai custom connectors at `https://floaters.flux.am/mcp/<MCP_SECRET>`. The path secret is the whole access control (claude.ai sends no credentials), so `MCP_SECRET` is its own value, never `CONNECT_SECRET`; unset means 404 everywhere. Tool calls GET the API over loopback with `CONNECT_SECRET` (`src/lib/mcp.ts`).
See `apps/mcp/README.md` for both setups.

## Deployment

API → Railway (always-on; `railway.json` at the root). See `docs/DEPLOY-RAILWAY.md` for the migration runbook (env vars, Xero redirect, DNS).

## Environment Variables

API (`apps/api/.env`): `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` / `XERO_REDIRECT_URI`, `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `CONNECT_SECRET`, `FLUX_LOGIN_SECRET` (enables login.flux.am sign-in), `BURNBAR_URL` / `BURNBAR_READ_TOKEN` (optional; enable hours from BurnBar), `MCP_SECRET` (optional; enables the remote MCP endpoint).
Web (dev only, `apps/web/.env`): `FLOATERS_DEV_API_URL`, `FLOATERS_DEV_API_KEY`. The production web build takes no variables.
MCP: `FLOATERS_API_URL`, `FLOATERS_API_KEY`.
