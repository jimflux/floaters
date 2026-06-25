import type { CashflowData, AccountGroup } from './types';

const API_BASE = 'https://floaters.onrender.com';
const API_KEY = 'c8659b9538ddc0bd800d04c5a18237b4';

const headers = { 'Authorization': `Bearer ${API_KEY}` };
const jsonHeaders = { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

export function getCashflow(): Promise<CashflowData> {
  return fetch(`${API_BASE}/api/cashflow?back=3&forward=12`, { headers }).then(res => {
    if (!res.ok) throw new Error(`API error: ${res.status}`);
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

export function setProjectionOverride(accountCode: string, month: string, amount: number): Promise<void> {
  return fetch(`${API_BASE}/api/projection-overrides`, {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({ accountCode, month, amount }),
  }).then(res => {
    if (!res.ok) throw new Error(`Set override failed: ${res.status}`);
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
