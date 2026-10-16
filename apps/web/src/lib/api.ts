import type { CashflowData, AccountGroup, PipelineResponse, TimeTrackingResponse } from './types';
import { clearSignInGuard, handleUnauthorised, SignInRequiredError } from './session';
import { clearCachedData } from './cache';
import type { PensionCashflow } from './retirement-pensions';
import type { RetirementPlan, RetirementSavedPlan } from '@floaters/types';
import type { CostSettingsChange } from '@floaters/types';

export async function saveCostSetting(change: CostSettingsChange): Promise<void> {
  const response = await apiFetch('/api/cost-settings', { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(change) }, false);
  if (!response.ok) throw new Error('Could not save cost forecast settings');
}

export async function removeCostSetting(change: { type: 'recurring' | 'dismissed'; streamKey: string } | { type: 'one_off'; transactionId: string }): Promise<void> {
  const response = await apiFetch(`/api/cost-settings?${new URLSearchParams(change)}`, { method: 'DELETE' }, false);
  if (!response.ok) throw new Error('Could not save cost forecast settings');
}

export { CASHFLOW_CACHE_KEY, OVERRIDES_CACHE_KEY } from './cache';

// The web app is served by the Next API itself (single service), so every
// request is same-origin and authenticated by the login.flux.am session cookie.
// The X-Floaters-Client header is what lets a cookie-authenticated request in:
// another flux.am subdomain can send the cookie but can't add the header.
// For local dev, the Vite server proxies /api and /auth to the API (see
// vite.config.ts).
const headers = { 'X-Floaters-Client': 'web' };
const jsonHeaders = { 'X-Floaters-Client': 'web', 'Content-Type': 'application/json' };

export function getRetirementPlan(): Promise<RetirementSavedPlan> {
  return apiFetch('/api/retirement', { cache: 'no-store' }).then(res => {
    if (!res.ok) throw new Error('Could not load your saved retirement plan.');
    return res.json();
  });
}

export async function saveRetirementPlan(plan: RetirementPlan): Promise<RetirementSavedPlan> {
  // A failed save must not navigate away from an unsaved plan.
  const response = await apiFetch('/api/retirement', {
    method: 'PUT', headers: jsonHeaders, body: JSON.stringify(plan),
  }, false);
  if (!response.ok) throw new Error('Could not save your retirement plan. Your draft is still here.');
  // Read through the same endpoint used after a reload before claiming success.
  const readBack = await apiFetch('/api/retirement', { cache: 'no-store' }, false);
  if (!readBack.ok) throw new Error('Could not verify your saved retirement plan. Your draft is still here.');
  const saved: RetirementSavedPlan = await readBack.json();
  if (!saved.savedAt || JSON.stringify(saved.plan) !== JSON.stringify(plan)) {
    throw new Error('Saved retirement plan did not match your changes. Your draft is still here.');
  }
  return saved;
}

function apiFetch(path: string, init: RequestInit & { headers?: Record<string, string> } = {}, redirectOnUnauthorised = true): Promise<Response> {
  return fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { ...headers, ...init.headers },
  }).then(res => {
    if (res.status === 401) {
      if (redirectOnUnauthorised) return handleUnauthorised();
      clearCachedData();
      throw new SignInRequiredError();
    }
    clearSignInGuard();
    return res;
  });
}

export function getRetirementPensionCashflow(): Promise<PensionCashflow> {
  return apiFetch('/api/cashflow?back=12&forward=24', {}, false).then(res => {
    if (!res.ok) throw new Error(`Could not load pension cashflow: ${res.status}`);
    return res.json();
  });
}

export function getCashflow(exclusions: { costs: string[]; clients: string[] } = { costs: [], clients: [] }): Promise<CashflowData> {
  const params = new URLSearchParams({ back: '3', forward: '12' });
  for (const code of exclusions.costs) params.append('excludeCost', code);
  for (const key of exclusions.clients) params.append('excludeClient', key);
  return apiFetch(`/api/cashflow?${params}`, { headers }).then(res => {
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  });
}

export function getPipeline(): Promise<PipelineResponse> {
  return apiFetch(`/api/pipeline`, { headers }).then(res => {
    if (!res.ok) throw new Error(`Pipeline fetch failed: ${res.status}`);
    return res.json();
  });
}

// --- Time tracking (BurnBar) ---
// Same window as the cashflow query so the Hours section lines up with the grid.
// The API reads BurnBar live and keeps a copy for a minute; fresh skips it.
export function getTimeTracking(fresh = false): Promise<TimeTrackingResponse> {
  return apiFetch(`/api/time?back=3&forward=12${fresh ? '&fresh=1' : ''}`, { headers }).then(res => {
    if (!res.ok) throw new Error(`Time tracking fetch failed: ${res.status}`);
    return res.json();
  });
}

// Link a BurnBar client to a pipeline client key; null clears the explicit
// link and falls back to the name match.
export function patchTimeClientLink(togglClientId: number, clientKey: string | null): Promise<void> {
  return apiFetch(`/api/time`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify({ togglClientId, clientKey }),
  }).then(res => {
    if (!res.ok) throw new Error(`Update link failed: ${res.status}`);
  });
}

export function triggerSync(): Promise<void> {
  return apiFetch(`/api/sync`, { method: 'POST', headers }).then(res => {
    if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
  });
}

export function hideAccount(accountCode: string): Promise<void> {
  return apiFetch(`/api/hidden-accounts`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ accountCode }),
  }).then(res => {
    if (!res.ok) throw new Error(`Hide failed: ${res.status}`);
  });
}

export function unhideAccount(accountCode: string): Promise<void> {
  return apiFetch(`/api/hidden-accounts?accountCode=${encodeURIComponent(accountCode)}`, {
    method: 'DELETE',
    headers,
  }).then(res => {
    if (!res.ok) throw new Error(`Unhide failed: ${res.status}`);
  });
}

export function getAccountGroups(): Promise<{ groups: AccountGroup[] }> {
  return apiFetch(`/api/account-groups`, { headers }).then(res => {
    if (!res.ok) throw new Error(`Fetch groups failed: ${res.status}`);
    return res.json();
  });
}

export function createAccountGroup(name: string, accountCodes: string[]): Promise<void> {
  return apiFetch(`/api/account-groups`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ name, accountCodes }),
  }).then(res => {
    if (!res.ok) throw new Error(`Create group failed: ${res.status}`);
  });
}

export function deleteAccountGroup(id: string): Promise<void> {
  return apiFetch(`/api/account-groups?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
  }).then(res => {
    if (!res.ok) throw new Error(`Delete group failed: ${res.status}`);
  });
}

export interface VatSettings {
  enabled: boolean;
  paidQuarters: string[];
  overrides: { clientKey: string; vatable: boolean }[];
}

export function getVatSettings(): Promise<VatSettings> {
  return apiFetch(`/api/vat`, { headers }).then(res => {
    if (!res.ok) throw new Error(`Fetch VAT settings failed: ${res.status}`);
    return res.json();
  });
}

export interface VatPatch {
  enabled?: boolean;
  clientKey?: string;
  vatable?: boolean;
  markPaidQuarter?: string;
  unmarkPaidQuarter?: string;
}

export function patchVat(patch: VatPatch): Promise<void> {
  return apiFetch(`/api/vat`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(patch),
  }).then(res => {
    if (!res.ok) throw new Error(`Update VAT settings failed: ${res.status}`);
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
  return apiFetch(`/api/projection-overrides`, { headers }).then(res => {
    if (!res.ok) throw new Error(`Fetch overrides failed: ${res.status}`);
    return res.json();
  });
}

export function setProjectionOverride(accountCode: string, month: string, amount: number): Promise<void> {
  return apiFetch(`/api/projection-overrides`, {
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
  recurrenceCount?: number; // monthly occurrences from expectedMonth (1 = one-off)
  escalationPct?: number; // % uplift per block
  escalationEvery?: number | null; // occurrences per escalation block
}

export function createProjection(input: ProjectionInput): Promise<void> {
  return apiFetch(`/api/projections`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(input),
  }).then(res => {
    if (!res.ok) throw new Error(`Create projection failed: ${res.status}`);
  });
}

export function updateProjection(id: string, patch: Partial<ProjectionInput>): Promise<void> {
  return apiFetch(`/api/projections/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(patch),
  }).then(res => {
    if (!res.ok) throw new Error(`Update projection failed: ${res.status}`);
  });
}

export function deleteProjection(id: string): Promise<void> {
  return apiFetch(`/api/projections/${encodeURIComponent(id)}`, {
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
  return apiFetch(`/api/adjustments/${encodeURIComponent(invoiceId)}`, {
    method: 'PATCH',
    headers: jsonHeaders,
    body: JSON.stringify(body),
  }).then(res => {
    if (!res.ok) throw new Error(`Review failed: ${res.status}`);
  });
}

export function removeProjectionOverride(accountCode: string, month: string): Promise<void> {
  return apiFetch(`/api/projection-overrides?accountCode=${encodeURIComponent(accountCode)}&month=${encodeURIComponent(month)}`, {
    method: 'DELETE',
    headers,
  }).then(res => {
    if (!res.ok) throw new Error(`Remove override failed: ${res.status}`);
  });
}
