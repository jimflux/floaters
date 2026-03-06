-- Enable RLS on all tables and deny all access via anon/authenticated roles.
-- All access goes through the service_role key from the backend.

alter table xero_connections enable row level security;
alter table xero_accounts enable row level security;
alter table xero_invoices enable row level security;
alter table xero_bank_transactions enable row level security;
alter table scenarios enable row level security;
alter table scenario_items enable row level security;
alter table budgets enable row level security;
alter table budget_lines enable row level security;
alter table cash_thresholds enable row level security;
alter table account_groups enable row level security;
alter table sync_log enable row level security;

-- No policies = no access via anon or authenticated roles.
-- Only the service_role key (used by our backend) bypasses RLS.
