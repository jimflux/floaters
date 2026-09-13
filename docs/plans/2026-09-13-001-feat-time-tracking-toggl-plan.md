---
title: "feat: time tracking from Toggl"
type: feat
date: 2026-09-13
---

# feat: time tracking from Toggl

## Summary

Pull hours from Toggl Track and show them next to the money. An "Hours" section under the cashflow grid rolls time up by Toggl client per month over the same window as the grid, with billable hours split out and, for clients linked to the income pipeline, the ex-VAT amount invoiced that month so an effective rate is one division away. Hours are context, never cash: nothing feeds either balance walk.

## Key decisions

- **Token in env, not the database.** Toggl uses a static personal API token, so `TOGGL_API_TOKEN` sits alongside the other API secrets. No OAuth flow, no settings UI for credentials. Without the token the feature reports itself unconfigured and the section explains how to connect.
- **Same history window as cash.** A full sync walks `HISTORY_MONTHS` month by month through `/me/time_entries?start_date&end_date&meta=true`; incremental syncs use `since` (which also returns deletions, stored as `deleted_at`). A cursor older than 60 days falls back to a full walk because Toggl's `since` window is short.
- **Running entries are timed at read.** Toggl reports a running entry with a negative duration; it is stored with `duration_seconds = null` and the rollup computes the live duration from `start`.
- **Local-day bucketing.** Toggl stores UTC. Entries bucket by their start day in `TOGGL_TIMEZONE` (default `Europe/London`) so a late-evening entry lands on the right day and month.
- **Client linking reuses `clientKey()`.** A Toggl client resolves to a pipeline client key by an explicit link (`toggl_clients.client_key`, a local column omitted from sync upserts) or a normalised-name match against contacts seen on ACCREC invoices and projection labels. Linked clients carry `invoicedExVat` by issue month.
- **One sync button.** `POST /api/sync` runs the Toggl sync after Xero when configured and reports a Toggl failure in the response rather than failing the Xero sync. `POST /api/time/sync` runs it alone.

## Surfaces

- API: `GET /api/time`, `PATCH /api/time` (link), `POST /api/time/sync`, `GET /api/time/entries`.
- Web: `TimeSection` (grid section), `TimePanel` (sync state, running entry, client links), a mobile hours block.
- MCP: `get_time_tracking`, `list_time_entries`.
- DB: migration 012 (`toggl_state`, `toggl_clients`, `toggl_projects`, `toggl_time_entries`).

## Rollout

1. Apply migration 012.
2. Set `TOGGL_API_TOKEN` on Railway (optional `TOGGL_WORKSPACE_ID`, `TOGGL_TIMEZONE`).
3. Press Sync Now (or `POST /api/time/sync {full:true}`); the first run walks 12 months at about one request per second.
4. Open the Hours panel and check the auto-matched client links; set any the name match missed.

## Out of scope for v1

Writing to Toggl, per-tag breakdowns, rate cards beyond Toggl's own project rate, and using hours to project income.
