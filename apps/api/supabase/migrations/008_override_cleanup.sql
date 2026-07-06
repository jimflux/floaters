-- Income overrides retire at the pipeline cutover (R12): the cashflow route no
-- longer reads projection_overrides for income accounts. Destructive: run ONLY
-- after the income-pipeline release is verified live. Before applying, log a
-- dry-run count:
--
--   select count(*) from projection_overrides po
--   where exists (
--     select 1 from xero_accounts a
--     where a.connection_id = po.connection_id
--       and a.code = po.account_code
--       and a.type in ('REVENUE', 'SALES', 'OTHERINCOME')
--   );
--
-- Deletes ONLY overrides that map to an income-typed account. Deliberately
-- narrow: cost overrides (incl. the UNCATEGORISED cost row, which the route
-- still honours when there are uncategorised cost flows) and overrides on
-- archived or orphaned codes are left untouched — the route already ignores
-- the dead ones, and deleting a live cost override would silently shift the
-- committed balance.
delete from projection_overrides po
where exists (
  select 1 from xero_accounts a
  where a.connection_id = po.connection_id
    and a.code = po.account_code
    and a.type in ('REVENUE', 'SALES', 'OTHERINCOME')
);
