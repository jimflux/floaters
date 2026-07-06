-- Income overrides retire at the pipeline cutover (R12). Destructive: run
-- ONLY after the income-pipeline release is verified live. Before applying,
-- log a dry-run count:
--
--   select count(*) from projection_overrides po
--   where not exists (
--     select 1 from xero_accounts a
--     where a.connection_id = po.connection_id
--       and a.code = po.account_code
--       and a.status = 'ACTIVE'
--       and a.type not in ('REVENUE', 'SALES', 'OTHERINCOME', 'BANK')
--   );
--
-- Deletes every override not owned by an active cost account: income types,
-- UNCATEGORISED, and orphaned codes. Costs keep the override model unchanged.
delete from projection_overrides po
where not exists (
  select 1 from xero_accounts a
  where a.connection_id = po.connection_id
    and a.code = po.account_code
    and a.status = 'ACTIVE'
    and a.type not in ('REVENUE', 'SALES', 'OTHERINCOME', 'BANK')
);
