-- Older deployments can have the Xero tables without the scenarios table from
-- 001_initial_schema.sql. Retirement plans require this private storage.
do $migration$
begin
  if to_regclass('public.scenarios') is null then
    create table public.scenarios (
      id uuid primary key default gen_random_uuid(),
      connection_id uuid references public.xero_connections(id) on delete cascade not null,
      name text not null,
      description text,
      is_active boolean default false,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
    alter table public.scenarios enable row level security;
    revoke all on public.scenarios from public, anon, authenticated;
    grant select, insert, update, delete on public.scenarios to service_role;
  end if;
end
$migration$;

notify pgrst, 'reload schema';
