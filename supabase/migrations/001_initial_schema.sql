-- Xero connection and tokens
create table xero_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null unique,
  tenant_name text,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz not null,
  scopes text[],
  last_synced_at timestamptz,
  sync_status text default 'idle' check (sync_status in ('idle', 'syncing', 'error')),
  sync_error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Synced Xero accounts (chart of accounts)
create table xero_accounts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references xero_connections(id) on delete cascade not null,
  xero_id text not null,
  code text,
  name text not null,
  type text not null,
  class text,
  status text,
  bank_account_type text,
  current_balance numeric(15,2),
  created_at timestamptz default now(),
  unique(connection_id, xero_id)
);

-- Synced invoices (both AR and AP)
create table xero_invoices (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references xero_connections(id) on delete cascade not null,
  xero_id text not null,
  type text not null check (type in ('ACCREC', 'ACCPAY')),
  contact_name text,
  contact_id text,
  status text not null,
  currency_code text default 'GBP',
  total numeric(15,2) not null,
  amount_due numeric(15,2) not null,
  amount_paid numeric(15,2) default 0,
  issue_date date not null,
  due_date date not null,
  expected_payment_date date,
  fully_paid_on_date date,
  line_items jsonb,
  xero_updated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(connection_id, xero_id)
);

-- Synced bank transactions (actuals)
create table xero_bank_transactions (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references xero_connections(id) on delete cascade not null,
  xero_id text not null,
  type text not null,
  contact_name text,
  account_code text,
  account_name text,
  total numeric(15,2) not null,
  date date not null,
  status text,
  is_reconciled boolean default false,
  xero_updated_at timestamptz,
  created_at timestamptz default now(),
  unique(connection_id, xero_id)
);

-- Scenarios (what-if planning)
create table scenarios (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references xero_connections(id) on delete cascade not null,
  name text not null,
  description text,
  is_active boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Individual items within a scenario
create table scenario_items (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid references scenarios(id) on delete cascade not null,
  type text not null check (type in ('income', 'expense')),
  description text not null,
  amount numeric(15,2) not null,
  frequency text not null check (frequency in ('once', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly')),
  start_date date not null,
  end_date date,
  created_at timestamptz default now()
);

-- Budget entries
create table budgets (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references xero_connections(id) on delete cascade not null,
  name text not null,
  period_type text not null default 'monthly' check (period_type in ('monthly', 'weekly')),
  created_at timestamptz default now()
);

create table budget_lines (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid references budgets(id) on delete cascade not null,
  category text not null,
  type text not null check (type in ('income', 'expense')),
  amount numeric(15,2) not null,
  period_start date not null,
  created_at timestamptz default now()
);

-- Cash threshold alerts
create table cash_thresholds (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references xero_connections(id) on delete cascade not null,
  minimum_balance numeric(15,2) not null,
  alert_email boolean default true,
  created_at timestamptz default now()
);

-- User-defined account groups
create table account_groups (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references xero_connections(id) on delete cascade not null,
  name text not null,
  account_ids uuid[] not null,
  color text,
  created_at timestamptz default now()
);

-- Sync log for debugging / audit
create table sync_log (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references xero_connections(id) on delete cascade not null,
  started_at timestamptz default now(),
  completed_at timestamptz,
  status text not null check (status in ('success', 'error')),
  records_synced int default 0,
  error_message text
);

-- Indexes for forecast queries
create index idx_invoices_connection_due on xero_invoices(connection_id, due_date);
create index idx_invoices_connection_status on xero_invoices(connection_id, status);
create index idx_bank_txn_connection_date on xero_bank_transactions(connection_id, date);
create index idx_accounts_connection_type on xero_accounts(connection_id, type);
create index idx_scenario_items_scenario on scenario_items(scenario_id);
create index idx_budget_lines_budget on budget_lines(budget_id);
