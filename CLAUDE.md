# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Backend API for a cash flow forecasting app (clone of Float's cash flow tab). Connects to Xero to sync financial data and projects cash flow forward. Single user (Jim only). Frontend is built separately in Lovable.

## Commands

```bash
npm run dev      # Start dev server (port 3000)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Stack

- **Next.js 15** (App Router) — API routes only, no frontend pages
- **TypeScript** with strict mode
- **Supabase** (Postgres) — database via service role key, no RLS
- **Xero API** — OAuth 2.0 Web app type (standard auth code flow, not PKCE)
- **GBP** as primary currency

## Architecture

### Auth Flow
User hits `/auth/login` → redirects to Xero OAuth → callback at `/auth/callback` exchanges code for tokens, stores connection in DB, creates JWT session cookie, triggers initial sync, redirects to Lovable frontend.

Session is a self-managed JWT (via `jose`) in an httpOnly cookie. No Supabase Auth — just Supabase as a database with service role key.

### Xero Sync
`src/lib/xero/sync.ts` handles initial and incremental sync. Rate-limited to ~54 calls/min via `bottleneck`. Syncs accounts, invoices (ACCREC), bills (ACCPAY), and bank transactions. Upserts to Supabase on `(connection_id, xero_id)` unique constraints.

Token refresh is automatic — `getValidAccessToken()` in `src/lib/xero/auth.ts` refreshes if within 5 minutes of expiry.

### Forecast Engine
`src/lib/forecast/engine.ts` computes projected cash flow:
1. Starts from current bank balance (sum of BANK account balances)
2. Projects forward using due dates (or user-overridden `expected_payment_date`) of outstanding invoices/bills
3. Overlays scenario items (recurring income/expense) if scenario IDs are passed
4. Aggregates by period (daily/weekly/monthly)

### Key Files
- `src/lib/xero/auth.ts` — OAuth helpers, token refresh
- `src/lib/xero/client.ts` — Rate-limited Xero API client with pagination
- `src/lib/xero/sync.ts` — Sync engine (initial + incremental)
- `src/lib/forecast/engine.ts` — Cash flow projection logic
- `src/lib/auth.ts` — JWT session management
- `src/lib/api-helpers.ts` — Shared route handler utilities (requireConnection, error responses)
- `src/middleware.ts` — CORS handling for Lovable frontend
- `supabase/migrations/001_initial_schema.sql` — Full database schema

### API Routes
All under `src/app/api/`. Auth routes under `src/app/auth/`. Every route uses `requireConnection()` to validate the session and get the connection ID.

### Database
Single Supabase project. No RLS (single user). Key tables: `xero_connections`, `xero_invoices`, `xero_bank_transactions`, `xero_accounts`, `scenarios`, `scenario_items`, `budgets`, `budget_lines`, `cash_thresholds`, `account_groups`, `sync_log`.

## Environment Variables

Copy `.env.example` to `.env` and fill in:
- `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` / `XERO_REDIRECT_URI`
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
- `JWT_SECRET` (any random string for signing session tokens)
- `FRONTEND_URL` (Lovable app URL for CORS + redirects)

## Patterns

- All API routes return JSON via `json()` / `error()` helpers from `src/lib/api-helpers.ts`
- Request validation uses Zod v4 (`zod/v4` import path)
- Xero API calls go through `xeroRequest()` / `xeroRequestPaginated()` which handle auth headers, tenant ID, and rate limiting
- Supabase client is lazy-initialized (Proxy pattern) to avoid build-time errors from missing env vars
