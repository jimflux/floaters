-- Per-client VATable overrides. VATable status is a client property, not a
-- projection property (a client with only real invoices has no projection
-- row), so it is keyed on the same clientKey() the income rollup uses:
-- contact:<id> / label:<normalised>. An absent row means "no override": the
-- reader falls back to a seed from the client's real invoice tax, else VATable.
create table if not exists vatable_clients (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references xero_connections(id) on delete cascade not null,
  client_key text not null,
  vatable boolean not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (connection_id, client_key)
);
alter table vatable_clients enable row level security;

-- Per-connection VAT state singleton. `enabled` is the dark-launch flag: VAT
-- ships OFF and is switched on only after this migration + the tax backfill are
-- verified live, so a deploy-ordering slip degrades to today's behaviour rather
-- than 500ing. `paid_quarters` holds quarter-end keys (yyyy-MM) whose bill has
-- been paid, so the forecast stops projecting the current quarter's bill once
-- it's paid by untagged bank transfer. Rate and quarter stagger are fixed
-- constants in lib/vat.ts, not stored here.
create table if not exists vat_state (
  connection_id uuid primary key references xero_connections(id) on delete cascade,
  enabled boolean not null default false,
  paid_quarters text[] not null default '{}',
  updated_at timestamptz default now()
);
alter table vat_state enable row level security;
