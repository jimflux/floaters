-- Real per-invoice output VAT, synced from Xero's Invoice.TotalTax.
-- Nullable with no default on purpose: NULL means "not yet synced/backfilled"
-- (fall back to a VATable-aware estimate at read time), while 0 means a genuine
-- out-of-scope / zero-rated invoice (e.g. IKEA). Blind total/6 must never be
-- used on a real invoice, so the two states have to stay distinguishable.
alter table xero_invoices add column if not exists total_tax numeric(15,2);
