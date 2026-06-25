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
`src/lib/xero/sync.ts` — initial + incremental sync, rate-limited to ~54 calls/min via `bottleneck`. Syncs accounts, invoices (ACCREC/ACCPAY), and bank transactions. Writes via **batched** `chunkedUpsert()` (500-row chunks) on `(connection_id, xero_id)`. Token refresh is automatic in `src/lib/xero/auth.ts`.

### Forecast / cashflow
- `src/lib/forecast/engine.ts` — `computeForecast()` projects daily flows from invoice/bill due (or `expected_payment_date`) dates, overlays scenario items, aggregates by period. `getOccurrences()` expands recurrence.
- `src/app/api/cashflow/route.ts` — the main dashboard endpoint: groups actuals + projections by Xero chart-of-accounts per month, applies manual `projection_overrides` (an actual invoice wins over an override), hides `hidden_accounts`, and computes opening/closing balances.

### Conventions
- Routes return JSON via `json()` / `error()` from `src/lib/api-helpers.ts`, which set **`Cache-Control: no-store`** (this is a live financial read — never cache it).
- Request validation uses Zod v4 (`zod/v4`).
- Supabase client is a lazy Proxy (`src/lib/supabase.ts`) to avoid build-time env errors.
- `src/middleware.ts` handles CORS for the web origins.

### Database
Key tables: `xero_connections`, `xero_invoices`, `xero_bank_transactions`, `xero_accounts`, `scenarios`, `scenario_items`, `budgets`, `budget_lines`, `cash_thresholds`, `account_groups`, `hidden_accounts`, `projection_overrides`, `sync_log`. Migrations in `apps/api/supabase/migrations/`.

## Web app (`apps/web`)

React Query for data; the cashflow query is `['cashflow']`. Editable projection cells (`src/components/EditableCell.tsx`) use the optimistic-mutation pattern (patch in `onMutate`, roll back in `onError`, invalidate in `onSettled`). API base/key come from `VITE_API_URL` / `VITE_API_KEY`.

## MCP server (`apps/mcp`)

Read-only. Tools (`get_cashflow`, `get_connection`, `get_forecast`, `list_transactions`) are GETs against the API, so the server can't mutate anything. Config: `FLOATERS_API_URL` + `FLOATERS_API_KEY`. See `apps/mcp/README.md` for the OpenClaw setup.

## Deployment

API → Railway (always-on; `railway.json` at the root). See `docs/DEPLOY-RAILWAY.md` for the migration runbook (env vars, Xero redirect, DNS).

## Environment Variables

API (`apps/api/.env`): `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` / `XERO_REDIRECT_URI`, `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `CONNECT_SECRET`, `FRONTEND_URL`.
Web (`apps/web/.env`): `VITE_API_URL`, `VITE_API_KEY`.
MCP: `FLOATERS_API_URL`, `FLOATERS_API_KEY`.
