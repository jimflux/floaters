import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { RETIREMENT_ASSETS, type RetirementPlan } from '@floaters/types';

const state = vi.hoisted(() => ({
  connection: 'connection-a', authenticated: true,
  rows: [] as Record<string, unknown>[], items: [] as Record<string, unknown>[],
  calls: [] as { table: string; operation: string; filters: Record<string, unknown>; payload?: unknown }[],
  failure: '' as '' | 'error' | 'throw',
}));
vi.mock('@/lib/auth', () => ({ resolveConnection: async () => state.authenticated ? { ok: true, connectionId: state.connection } : { ok: false, status: 401 } }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  const call = { table, operation: 'select', filters: {} as Record<string, unknown>, payload: undefined as unknown };
  state.calls.push(call);
  const result = () => {
    if (state.failure === 'throw') throw new Error('private-db-detail');
    if (state.failure === 'error') return { data: null, error: { message: 'private-db-detail' } };
    const rows = table === 'scenarios' ? state.rows : table === 'scenario_items' ? state.items : [];
    const filtered = rows.filter(row => Object.entries(call.filters).every(([key, value]) => {
      if (key.startsWith('neq:')) return row[key.slice(4)] !== value;
      if (key.startsWith('in:')) return (value as unknown[]).includes(row[key.slice(3)]);
      if (key === 'scenarios.connection_id') return state.rows.some(parent => parent.id === row.scenario_id && parent.connection_id === value);
      return row[key] === value;
    }));
    if (call.operation === 'upsert') {
      const payload = call.payload as Record<string, unknown>;
      const index = rows.findIndex(row => row.id === payload.id);
      if (index < 0) rows.push(payload); else rows[index] = payload;
      return { data: payload, error: null };
    }
    if (call.operation === 'update') filtered.forEach(row => Object.assign(row, call.payload));
    if (call.operation === 'delete') filtered.forEach(row => rows.splice(rows.indexOf(row), 1));
    return { data: filtered, error: null };
  };
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => { call.filters[key] = value; return builder; },
    neq: (key: string, value: unknown) => { call.filters[`neq:${key}`] = value; return builder; },
    in: (key: string, value: unknown) => { call.filters[`in:${key}`] = value; return builder; },
    order: () => builder, or: () => builder,
    upsert: (payload: unknown) => { call.operation = 'upsert'; call.payload = payload; return builder; },
    update: (payload: unknown) => { call.operation = 'update'; call.payload = payload; return builder; },
    delete: () => { call.operation = 'delete'; return builder; },
    maybeSingle: async () => { const response = result(); return { ...response, data: Array.isArray(response.data) ? response.data[0] ?? null : response.data }; },
    single: async () => { const response = result(); return { ...response, data: Array.isArray(response.data) ? response.data[0] ?? null : response.data }; },
    then: (fulfilled: (value: unknown) => unknown, rejected?: (reason: unknown) => unknown) => Promise.resolve().then(result).then(fulfilled, rejected),
  };
  return builder;
} } }));

import { GET, PUT } from './route';
import { retirementScenarioId } from '@/lib/retirement';
import { GET as listScenarios } from '../scenarios/route';
import { GET as getScenario, PATCH as patchScenario, DELETE as deleteScenario } from '../scenarios/[id]/route';
import { POST as postItem } from '../scenarios/[id]/items/route';
import { PATCH as patchItem, DELETE as deleteItem } from '../scenarios/[id]/items/[itemId]/route';
import { computeForecast, getDayTransactions } from '@/lib/forecast/engine';

function fixture(): RetirementPlan {
  const person = () => ({ name: 'Example', age: 60, retirementAge: 65, pensionAccessAge: 57, taxFreeAllowance: 268275,
    assets: Object.fromEntries(RETIREMENT_ASSETS.map(key => [key, { balance: 1000, annualContribution: 0, contributionGrowth: 0, returns: { cautious: 0, base: 0, optimistic: 0 } }])) as RetirementPlan['people'][0]['assets'] });
  return { version: 1, startYear: 2026, endAge: 95, partnerEnabled: false, people: [person(), person()], income: [], spending: [], oneOffs: [] };
}
const request = (body: unknown, headers?: Record<string, string>) => new NextRequest('http://localhost/api/retirement', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body), headers });
const params = (id: string, itemId = 'item-a') => ({ params: Promise.resolve({ id, itemId }) });
const uuidSpellings = ['canonical', 'uppercase', 'compact', 'braced', 'grouped'] as const;
function uuidSpelling(id: string, spelling: typeof uuidSpellings[number]): string {
  if (spelling === 'uppercase') return id.toUpperCase();
  if (spelling === 'compact') return id.replaceAll('-', '');
  if (spelling === 'braced') return `{${id}}`;
  if (spelling === 'grouped') return id.replaceAll('-', '').match(/.{4}/g)!.join('-');
  return id;
}

beforeEach(() => {
  state.connection = 'connection-a'; state.authenticated = true; state.rows = []; state.items = []; state.calls = []; state.failure = '';
  vi.restoreAllMocks();
});

describe('retirement persistence', () => {
  it('uses a stable valid reserved UUID unique to each connection', () => {
    expect(retirementScenarioId('connection-a')).toMatch(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(retirementScenarioId('connection-a')).toBe(retirementScenarioId('connection-a'));
    expect(retirementScenarioId('connection-a')).not.toBe(retirementScenarioId('connection-b'));
  });
  it('authenticates GET and PUT before reading a body or accessing the database', async () => {
    state.authenticated = false;
    const get = await GET();
    expect(get.status).toBe(401);
    const body = vi.fn(() => { throw new Error('body read'); });
    const input = { get body() { return body(); } } as unknown as NextRequest;
    expect((await PUT(input)).status).toBe(401);
    expect(body).not.toHaveBeenCalled();
    expect(state.calls).toEqual([]);
  });
  it('returns an empty no-store plan and scopes its lookup to the reserved id and connection', async () => {
    const response = await GET();
    expect(await response.json()).toEqual({ plan: null, savedAt: null });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(state.calls[0].filters).toEqual({ id: retirementScenarioId(state.connection), connection_id: state.connection });
  });
  it('roundtrips a plain plan and idempotently upserts one inactive record with an updated timestamp', async () => {
    const plan = fixture();
    const response = await PUT(request(plan));
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.plan).toEqual(plan);
    expect(saved.savedAt).toMatch(/^\d{4}-/);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(state.rows[0]).toMatchObject({ id: retirementScenarioId(state.connection), connection_id: state.connection, is_active: false, updated_at: saved.savedAt });
    expect(state.calls.every(call => call.table === 'scenarios')).toBe(true);
    expect(await (await GET()).json()).toEqual(saved);
    const updated = { ...plan, endAge: 90 };
    await PUT(request(updated));
    expect(state.rows).toHaveLength(1);
    expect((await (await GET()).json()).plan).toEqual(updated);
  });
  it('isolates saves and reads by connection', async () => {
    await PUT(request(fixture()));
    state.connection = 'connection-b';
    expect(await (await GET()).json()).toEqual({ plan: null, savedAt: null });
    await PUT(request({ ...fixture(), endAge: 90 }));
    expect(state.rows).toHaveLength(2);
    state.connection = 'connection-a';
    expect((await (await GET()).json()).plan.endAge).toBe(95);
  });
  it('roundtrips pension mappings including retained disabled partner settings', async () => {
    const plan = fixture();
    plan.balanceDate = '2026-10-15';
    plan.inflation = 0.025;
    plan.longevityAge = 100;
    plan.people[0].assets.pension.grossReturns = { cautious: 0.02, base: 0.05, optimistic: 0.07 };
    plan.people[0].assets.pension.annualFee = 0.005;
    plan.people[0].assets.pension.feesConfirmed = false;
    plan.people[0].assets.pension.feeSchedule = { threshold: 100000, below: 0.006, above: 0.002, fundCost: 0.001, marketSpread: 0.0005 };
    plan.childSavings = { name: 'Example child', balanceDate: '2026-10-14', jisa: 1200, universityFund: 500 };
    plan.pensionLinks = [{ accountCode: 'PENSION', person: 0, share: 0.4, startYear: 2026 }, { accountCode: 'PENSION', person: 1, share: 0.6, startYear: 2027 }];
    const response = await PUT(request(plan));
    expect(response.status).toBe(200);
    expect((await response.json()).plan).toEqual(plan);
    expect((await (await GET()).json()).plan).toEqual(plan);
  });
  it.each([
    [{ accountCode: 'PENSION', person: 0, share: 0, startYear: 2026 }],
    [{ accountCode: 'PENSION', person: 0, share: 1, startYear: 1999 }],
    [{ accountCode: '', person: 0, share: 1, startYear: 2026 }],
    [{ accountCode: 'PENSION', person: 0, share: 1, startYear: 2026 }, { accountCode: 'PENSION', person: 1, share: 0.1, startYear: 2026 }],
  ].map(pensionLinks => ({ pensionLinks })))('rejects invalid pension mappings before storage (%j)', async ({ pensionLinks }) => {
    const response = await PUT(request({ ...fixture(), pensionLinks }));
    expect(response.status).toBe(400);
    expect(state.calls).toEqual([]);
  });
  it.each(['{broken', { version: 2 }, { ...fixture(), endAge: 30 }])('rejects malformed or invalid data without writing', async body => {
    const response = await PUT(request(body));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(state.calls).toEqual([]);
  });
  it('enforces actual UTF-8 bytes even with a dishonest content-length header', async () => {
    const response = await PUT(request('é'.repeat(52000), { 'content-length': '1' }));
    expect(response.status).toBe(413);
    expect(state.calls).toEqual([]);
  });
  it('stops and cancels a streamed body as soon as the byte limit is exceeded', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(60000));
        controller.enqueue(new Uint8Array(60000));
        controller.enqueue(new Uint8Array(60000));
      }, cancel,
    });
    const input = { headers: new Headers(), body } as unknown as NextRequest;
    expect((await PUT(input)).status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(state.calls).toEqual([]);
  });
  it('validates row bounds and numeric settings before writing', async () => {
    const plan = fixture();
    plan.people[0].assets.pension.balance = -1;
    plan.oneOffs = Array.from({ length: 101 }, (_, index) => ({ id: String(index), label: 'Example', year: 2026, person: 0, asset: 'cash', amount: 1 }));
    expect((await PUT(request(plan))).status).toBe(400);
    expect(state.calls).toEqual([]);
  });
  it.each(['not-json', JSON.stringify({ kind: 'unexpected', version: 1, plan: fixture() }), JSON.stringify({ kind: 'floaters-retirement', version: 1, plan: { version: 1 } })])('reports corrupt stored data generically without logging', async description => {
    state.rows = [{ id: retirementScenarioId(state.connection), connection_id: state.connection, description, updated_at: '2026-10-14T00:00:00Z' }];
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Could not load retirement plan' });
    expect(log).not.toHaveBeenCalled();
  });
  it.each(['error', 'throw'] as const)('returns generic failures without logging private database details (%s)', async mode => {
    state.failure = mode;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const response of [await GET(), await PUT(request(fixture()))]) {
      expect(response.status).toBe(500);
      expect(JSON.stringify(await response.json())).not.toContain('private-db-detail');
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
    expect(log).not.toHaveBeenCalled();
  });
});

describe('reserved scenario isolation', () => {
  it('hides the reserved record from generic listing', async () => {
    await PUT(request(fixture()));
    state.rows.push({ id: 'normal', connection_id: state.connection, name: 'Business scenario' });
    const response = await listScenarios();
    expect((await response.json()).map((row: { id: string }) => row.id)).toEqual(['normal']);
  });
  it.each(uuidSpellings)('rejects all generic detail and item routes for a reserved UUID spelling (%s)', async spelling => {
    const id = uuidSpelling(retirementScenarioId(state.connection), spelling);
    const input = request({ amount: 10 });
    const responses = [await getScenario(input, params(id)), await patchScenario(input, params(id)), await deleteScenario(input, params(id)), await postItem(input, params(id)), await patchItem(input, params(id)), await deleteItem(input, params(id))];
    expect(responses.map(response => response.status)).toEqual([404, 404, 404, 404, 404, 404]);
    expect(state.calls).toEqual([]);
  });
  it.each([patchItem, deleteItem])('checks item parent ownership before item mutation', async mutate => {
    state.rows = [{ id: 'foreign', connection_id: 'connection-b' }];
    state.items = [{ id: 'item-a', scenario_id: 'foreign', amount: 100 }];
    const response = await mutate(request({ amount: 10 }), params('foreign'));
    expect(response.status).toBe(404);
    expect(state.calls.some(call => call.table === 'scenario_items')).toBe(false);
    expect(state.items[0].amount).toBe(100);
  });
  it.each([patchItem, deleteItem])('constrains item mutation to the verified parent id', async mutate => {
    state.rows = [{ id: 'owned', connection_id: state.connection }];
    state.items = [{ id: 'item-a', scenario_id: 'other-parent', amount: 100 }];
    await mutate(request({ amount: 10 }), params('owned'));
    const itemCall = state.calls.find(call => call.table === 'scenario_items');
    expect(itemCall?.filters).toEqual({ id: 'item-a', scenario_id: 'owned' });
    expect(state.items).toHaveLength(1);
    expect(state.items[0].amount).toBe(100);
  });
  it('preserves authorised item editing and deletion under an owned scenario', async () => {
    state.rows = [{ id: 'owned', connection_id: state.connection }];
    state.items = [{ id: 'item-a', scenario_id: 'owned', amount: 100 }];
    expect((await patchItem(request({ amount: 10 }), params('owned'))).status).toBe(200);
    expect(state.items[0].amount).toBe(10);
    expect((await deleteItem(request({}), params('owned'))).status).toBe(200);
    expect(state.items).toEqual([]);
  });
  it.each(uuidSpellings)('drops a reserved UUID spelling from both legacy forecasts (%s)', async spelling => {
    const id = uuidSpelling(retirementScenarioId(state.connection), spelling);
    const periods = await computeForecast(state.connection, 'daily', '2026-10-14', '2026-10-14', [id]);
    const transactions = await getDayTransactions(state.connection, '2026-10-14', [id]);
    expect(periods[0].scenarioInflows).toBeUndefined();
    expect(transactions).toEqual([]);
    expect(state.calls.some(call => call.table === 'scenario_items')).toBe(false);
  });
  it('keeps other forecast ids and scopes their parent connection', async () => {
    const id = retirementScenarioId(state.connection);
    await computeForecast(state.connection, 'daily', '2026-10-14', '2026-10-14', [id, 'normal']);
    await getDayTransactions(state.connection, '2026-10-14', [id, 'normal']);
    const calls = state.calls.filter(call => call.table === 'scenario_items');
    expect(calls).toHaveLength(2);
    calls.forEach(call => expect(call.filters).toMatchObject({ 'in:scenario_id': ['normal'], 'scenarios.connection_id': state.connection }));
  });
});
