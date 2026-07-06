-- Invoice payments live on Xero's Payments endpoint, not BankTransactions.
-- They are the cash side of invoice settlement, needed for a true cash-basis
-- history in the cashflow dashboard.
create table if not exists xero_payments (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references xero_connections(id) on delete cascade not null,
  xero_id text not null,
  invoice_xero_id text not null,
  -- ACCRECPAYMENT (money in) / ACCPAYPAYMENT (money out); direction must not
  -- depend on the invoice row existing locally
  payment_type text,
  status text,
  amount numeric(15,2) not null,
  date date not null,
  xero_updated_at timestamptz,
  created_at timestamptz default now(),
  unique(connection_id, xero_id)
);

alter table xero_payments enable row level security;

create index if not exists idx_payments_connection_date on xero_payments(connection_id, date);
create index if not exists idx_payments_connection_invoice on xero_payments(connection_id, invoice_xero_id);
