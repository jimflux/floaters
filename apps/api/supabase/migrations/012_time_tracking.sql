-- Time tracking, pulled from Toggl Track. Hours are context for the cashflow
-- (what was worked vs what was invoiced per client), never cash: nothing here
-- feeds either balance walk. The Toggl API token lives in the API's env
-- (TOGGL_API_TOKEN), not in the database.

-- Per-connection Toggl sync state singleton (mirrors xero_connections' sync
-- columns). workspace_id is resolved on the first sync from /me unless
-- TOGGL_WORKSPACE_ID overrides it.
create table if not exists toggl_state (
  connection_id uuid primary key references xero_connections(id) on delete cascade,
  workspace_id bigint,
  last_synced_at timestamptz,
  sync_status text not null default 'idle' check (sync_status in ('idle', 'syncing', 'error')),
  sync_error text,
  updated_at timestamptz default now()
);
alter table toggl_state enable row level security;

-- Toggl clients. client_key is a LOCAL column (omitted from sync upserts so it
-- survives re-sync): an explicit link from a Toggl client to a pipeline client
-- key (contact:<id> / label:<normalised>). Absent means "auto-match by name".
create table if not exists toggl_clients (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references xero_connections(id) on delete cascade not null,
  toggl_id bigint not null,
  name text not null,
  archived boolean not null default false,
  toggl_updated_at timestamptz,
  client_key text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (connection_id, toggl_id)
);
alter table toggl_clients enable row level security;

create table if not exists toggl_projects (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references xero_connections(id) on delete cascade not null,
  toggl_id bigint not null,
  toggl_client_id bigint,
  name text not null,
  active boolean not null default true,
  billable boolean,
  rate numeric(15,2),
  currency text,
  color text,
  toggl_updated_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (connection_id, toggl_id)
);
alter table toggl_projects enable row level security;

-- Time entries. duration_seconds is NULL while the entry is running (Toggl
-- reports a negative duration); readers compute the live duration from start.
-- Deleted entries are kept with deleted_at set (incremental syncs with `since`
-- return deletions) and are excluded at read time. project_name / client_name
-- are the snapshot Toggl returns with meta=true, a fallback for entries whose
-- project has since been deleted.
create table if not exists toggl_time_entries (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid references xero_connections(id) on delete cascade not null,
  toggl_id bigint not null,
  workspace_id bigint,
  project_id bigint,
  project_name text,
  client_name text,
  description text,
  start timestamptz not null,
  stop timestamptz,
  duration_seconds integer,
  billable boolean not null default false,
  tags text[] not null default '{}',
  toggl_updated_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (connection_id, toggl_id)
);
alter table toggl_time_entries enable row level security;

create index if not exists idx_toggl_time_entries_connection_start
  on toggl_time_entries(connection_id, start);
create index if not exists idx_toggl_projects_connection_client
  on toggl_projects(connection_id, toggl_client_id);
