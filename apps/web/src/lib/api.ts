import type { CashflowData, AccountGroup, PipelineResponse } from './types';

// The web app is served by the Next API itself (single service), so by default
// it talks to the same origin — '' makes requests like `/api/cashflow` relative.
// For local dev (vite on :8080, api on :3000) set VITE_API_URL=http://localhost:3000.
// NOTE: VITE_* values are embedded in the client bundle, so the API key is
// effectively public — this is a single-user app, but don't treat it as a secret.
const API_BASE = import.meta.env.VITE_API_URL ?? '';
const API_KEY = import.meta.env.VITE_API_KEY ?? '';

const headers = { 'Authorization': `Bearer ${API_KEY}` };
const jsonHeaders = { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

// localStorage warm-start keys, versioned: the response shape broke when
// income became layered (v2), and a stale pre-break payload hydrating the new
// UI would crash it — the web build does not typecheck, so the version bump is
// the only guard.
export const CASHFLOW_CACHE_KEY = 'cashflow_cache_v2';
export const OVERRIDES_CACHE_KEY = 'projection_overrides_cache_v2';

export function getCashflow(): Promise<CashflowData> {
  return fetch(`${API_BASE}/api/cashflow?back=3&forward=12`, { headers }).then(res => {
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  });
}

export function getPipeline(): Promise<PipelineResponse> {
  return fetch(`${API_BASE}/api/pipeline`, { headers }).then(res => {
    if (!res.ok) throw new Error(`Pipeline fetch failed: ${res.status}`);
    return res.json();
  });
}

export function triggerSync(): Promise<void> {
  return fetch(`${API_BASE}/api/sync`, { method: 'POST', headers }).then(res => {
    if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
  });
}

export function hideAccount(accountCode: string): Promise<void> {
  return fetch(`${API_BASE}/api/hidden-accounts`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ accountCode }),
  }).then(res => {
    if (!res.ok) throw new Error(`Hide failed: ${res.status}`);
  });
}

export function unhideAccount(accountCode: string): Promise<void> {
  return fetch(`${API_BASE}/api/hidden-accounts?accountCode=${encodeURIComponent(accountCode)}`, {
    method: 'DELETE',
    headers,
  }).then(res => {
    if (!res.ok) throw new Error(`Unhide failed: ${res.status}`);
  });
}

export function getAccountGroups(): Promise<{ groups: AccountGroup[] }> {
  return fetch(`${API_BASE}/api/account-groups`, { headers }).then(res => {
    if (!res.ok) throw new Error(`Fetch groups failed: ${res.status}`);
    return res.json();
  });
}

export function createAccountGroup(name: string, accountCodes: string[]): Promise<void> {
  return fetch(`${API_BASE}/api/account-groups`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ name, accountCodes }),
  }).then(res => {
    if (!res.ok) throw new Error(`Create group failed: ${res.status}`);
  });
}

export function deleteAccountGroup(id: string): Promise<void> {
  return fetch(`${API_BASE}/api/account-groups?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
  }).then(res => {
    if (!res.ok) throw new Error(`Delete group failed: ${res.status}`);
  });
}

export interface ProjectionOverrideEntry {
  accountCode: string;
  month: string;
  amount: number;
}

// Raw override amounts. The cashflow response only carries a hasOverride flag;
// the current month blends cash-to-date with the override, so the stored
// amount can't be recovered from the cell value.
export function getProjectionOverrides(): Promise<{ overrides: ProjectionOverrideEntry[] }> {
  return fetch(`${API_BASE}/api/projection-overrides`, { headers }).then(res => {
    if (!res.ok) throw new Error(`Fetch overrides failed: ${res.status}`);
    return res.json();
  });
}

export function setProjectionOverride(accountCode: string, month: string, amount: number): Promise<void> {
  return fetch(`${API_BASE}/api/projection-overrides`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ accountCode, month, amount }),
  }).then(res => {
    if (!res.ok) throw new Error(`Set override failed: ${res.status}`);
  });
}

// --- Income pipeline: projections CRUD + invoice review/assignment ---

export interface ProjectionInput {
  clientLabel: string;
  amount: number; // inc VAT
  expectedMonth: string; // yyyy-MM
  contactId?: string | null;
}

export function createProjection(input: ProjectionInput): Promise<void> {
  return fetch(`${API_BASE}/api/projections`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  }).then(res => {
    if (!res.ok) throw new Error(`Create projection failed: ${res.status}`);
  });
}

export function updateProjection(id: string, patch: Partial<ProjectionInput>): Promise<void> {
  return fetch(`${API_BASE}/api/projections/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(patch),
  }).then(res => {
    if (!res.ok) throw new Error(`Update projection failed: ${res.status}`);
  });
}

export function deleteProjection(id: string): Promise<void> {
  return fetch(`${API_BASE}/api/projections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
  }).then(res => {
    if (!res.ok) throw new Error(`Delete projection failed: ${res.status}`);
  });
}

// Review/assign goes through the adjustments endpoint (locally-owned invoice
// fields). projectionId: uuid assigns (and implies review); null unassigns;
// reviewed: true approves standalone.
export function reviewInvoice(
  invoiceId: string,
  body: { projectionId?: string | null; reviewed?: boolean }
): Promise<void> {
  return fetch(`${API_BASE}/api/adjustments/${encodeURIComponent(invoiceId)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(body),
  }).then(res => {
    if (!res.ok) throw new Error(`Review failed: ${res.status}`);
  });
}

export function removeProjectionOverride(accountCode: string, month: string): Promise<void> {
  return fetch(`${API_BASE}/api/projection-overrides?accountCode=${encodeURIComponent(accountCode)}&month=${encodeURIComponent(month)}`, {
    method: 'DELETE',
    headers,
  }).then(res => {
    if (!res.ok) throw new Error(`Remove override failed: ${res.status}`);
  });
}
