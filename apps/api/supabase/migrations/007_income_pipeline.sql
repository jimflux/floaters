-- Income pipeline: client-level projections (hoped-for work) that invoices are
-- assigned against. Purely additive — the destructive projection_overrides
-- cleanup ships separately as 008 once this release is verified live.
create table if not exists income_projections (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references xero_connections(id) on delete cascade not null,
  client_label text not null,
  -- Xero contact id; nullable until an invoice assignment backfills it
  contact_id text,
  -- VAT-inclusive, nets against assigned invoices' total (not amount_due)
  amount numeric(15,2) not null,
  -- yyyy-MM; lapse is derived at read time from this, never stored
  expected_month text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table income_projections enable row level security;

create index if not exists idx_income_projections_connection_month
  on income_projections(connection_id, expected_month);

-- Local columns on the synced invoices table: omitted from sync upserts so
-- they survive re-sync and heal (the expected_payment_date precedent).
-- on delete set null releases invoices back to standalone when a projection
-- is deleted; reviewed_at is untouched by that release.
alter table xero_invoices
  add column if not exists projection_id uuid references income_projections(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

create index if not exists idx_invoices_projection
  on xero_invoices(projection_id) where projection_id is not null;

-- Cutover: everything already synced predates the review tray; stamp it
-- reviewed so the tray starts empty.
update xero_invoices set reviewed_at = now() where reviewed_at is null;
