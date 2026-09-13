// Toggl Track API v9 shapes, only the fields the sync reads.
// https://engineering.toggl.com/docs/track/api/

export interface TogglMe {
  id: number;
  default_workspace_id: number;
  email?: string;
  fullname?: string;
  timezone?: string;
}

export interface TogglClient {
  id: number;
  wid: number;
  name: string;
  archived?: boolean;
  at?: string;
  server_deleted_at?: string | null;
}

export interface TogglProject {
  id: number;
  workspace_id: number;
  client_id: number | null;
  name: string;
  active: boolean;
  billable?: boolean | null;
  rate?: number | null;
  currency?: string | null;
  color?: string | null;
  at?: string;
  server_deleted_at?: string | null;
}

export interface TogglTimeEntry {
  id: number;
  workspace_id: number;
  project_id: number | null;
  task_id?: number | null;
  description?: string | null;
  start: string; // UTC ISO
  stop: string | null; // null while running
  duration: number; // seconds; negative while running
  billable: boolean;
  tags?: string[] | null;
  tag_ids?: number[] | null;
  at?: string;
  server_deleted_at?: string | null;
  user_id?: number;
  // meta=true extras
  project_name?: string | null;
  client_name?: string | null;
  client_id?: number | null;
}

// Reports API v3 search row: one row per (project, description, billable,
// tags) group with the individual entries nested. Only fields the sync reads.
export interface TogglReportRow {
  user_id?: number;
  project_id: number | null;
  task_id?: number | null;
  billable: boolean;
  description: string | null;
  tag_ids?: number[] | null;
  row_number?: number;
  time_entries: Array<{
    id: number;
    seconds: number;
    start: string;
    stop: string | null;
    at?: string;
  }>;
}
