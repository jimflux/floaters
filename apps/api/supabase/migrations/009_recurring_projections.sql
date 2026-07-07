-- Recurring projections: a projection can span several months from its start
-- (expected_month), optionally stepping up by a % every N occurrences. Purely
-- additive; existing rows keep recurrence_count = 1 (single-shot) and no
-- escalation, so their behaviour is unchanged. Occurrences are expanded at
-- read time (lib/pipeline.ts), never materialised.
alter table income_projections
  -- number of monthly occurrences from expected_month inclusive (1 = single)
  add column if not exists recurrence_count integer not null default 1,
  -- % uplift applied every escalation_every occurrences, compounding per block
  add column if not exists escalation_pct numeric(6,3) not null default 0,
  -- occurrences per escalation block; null or 0 means no escalation
  add column if not exists escalation_every integer;

alter table income_projections
  add constraint income_projections_recurrence_count_positive
    check (recurrence_count >= 1);
