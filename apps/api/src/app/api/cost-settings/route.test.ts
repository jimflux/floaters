import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], fail: false }));
vi.mock('@/lib/api-helpers', () => ({
  requireConnection: async () => 'connection-a', json: (body: unknown) => body,
  error: (message: string, status: number) => ({ error: message, status }), handleError: () => ({ error: 'Authentication failed' }),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc: async (_name: string, args: { p_connection_id: string; p_rule_key: string; p_rule: { type: string; rule?: typeof rule & { matchStreamKeys?: string[] } } }) => {
    if (state.fail) return { data: null, error: { message: 'private database details' } };
    const incoming = args.p_rule.rule;
    const conflict = incoming && state.rows.some(row => {
      const saved = row.rule as typeof args.p_rule;
      return row.connection_id === args.p_connection_id && row.rule_key !== args.p_rule_key && saved.rule?.accountCode === incoming.accountCode
        && [saved.rule.streamKey, ...(saved.rule.matchStreamKeys ?? [])].some(key => [incoming.streamKey, ...(incoming.matchStreamKeys ?? [])].includes(key));
    });
    if (conflict) return { data: false, error: null };
    state.rows = state.rows.filter(row => row.connection_id !== args.p_connection_id || row.rule_key !== args.p_rule_key);
    state.rows.push({ connection_id: args.p_connection_id, rule_key: args.p_rule_key, rule: args.p_rule });
    return { data: true, error: null };
  },
  from: () => {
  const filters: Record<string, unknown> = {};
  let start = 0; let end = 999;
  let operation = 'select'; let payload: Record<string, unknown>;
  const builder = {
    select: () => builder,
    order: () => builder,
    range: (from: number, to: number) => { start = from; end = to; return builder; },
    eq: (key: string, value: unknown) => { filters[key] = value; return builder; },
    upsert: (row: Record<string, unknown>) => { operation = 'upsert'; payload = row; return builder; },
    delete: () => { operation = 'delete'; return builder; },
    then: (done: (result: unknown) => unknown) => {
      if (state.fail) return Promise.resolve(done({ data: null, error: { message: 'private database details' } }));
      const matches = (row: Record<string, unknown>) => Object.entries(filters).every(([k, v]) => row[k] === v);
      if (operation === 'delete') state.rows = state.rows.filter(row => !matches(row));
      if (operation === 'upsert') {
        state.rows = state.rows.filter(row => row.connection_id !== payload.connection_id || row.rule_key !== payload.rule_key);
        state.rows.push(payload);
      }
      return Promise.resolve(done({ data: state.rows.filter(matches).slice(start, end + 1), error: null }));
    },
  };
  return builder;
} } }));
import { GET, PUT, DELETE } from './route';
const rule = { accountCode: '400', streamKey: 'software', label: 'Software', amount: 300, frequencyMonths: 1, startMonth: '2026-10', endMonth: null };
const request = (value: unknown) => new NextRequest('http://localhost/api/cost-settings', { method: 'PUT', body: JSON.stringify(value) });
beforeEach(() => { state.rows = []; state.fail = false; });
describe('saved cost forecast decisions', () => {
  it('round-trips schedules and one-offs, and scopes deletion to the connection', async () => {
    state.rows = [{ connection_id: 'connection-b', rule_key: 'recurring:software', rule: { type: 'recurring', rule } }];
    expect(await PUT(request({ type: 'recurring', rule }))).toEqual({ ok: true });
    expect(await PUT(request({ type: 'one_off', transactionId: 'payment:1' }))).toEqual({ ok: true });
    expect(await GET()).toEqual({ rules: [rule], oneOffIds: ['payment:1'] });
    expect(await DELETE(new NextRequest('http://localhost/api/cost-settings?type=recurring&streamKey=software'))).toEqual({ ok: true });
    expect(await GET()).toEqual({ rules: [], oneOffIds: ['payment:1'] });
    expect(state.rows.some(r => r.connection_id === 'connection-b')).toBe(true);
  });
  it.each([{ amount: -1 }, { startMonth: '2026-13' }, { frequencyMonths: 2 }, { endMonth: '2026-09' }, { amount: Infinity }])('rejects invalid schedule %j', async patch => {
    expect(await PUT(request({ type: 'recurring', rule: { ...rule, ...patch } }))).toMatchObject({ status: 400 });
    expect(state.rows).toHaveLength(0);
  });
  it('reports storage failure without leaking database details or returning empty settings', async () => {
    state.fail = true;
    expect(await GET()).toEqual({ error: 'Could not load cost forecast settings', status: 500 });
    expect(await PUT(request({ type: 'recurring', rule }))).toEqual({ error: 'Could not save cost forecast settings', status: 500 });
    expect(await DELETE(new NextRequest('http://localhost/api/cost-settings?type=one_off&transactionId=p'))).toMatchObject({ status: 500 });
  });
});

it('loads every saved one-off beyond the API default page size', async () => {
  state.rows = Array.from({ length: 1001 }, (_, i) => ({ connection_id: 'connection-a', rule_key: `one_off:${i}`, rule: { type: 'one_off', transactionId: `payment:${i}` } }));
  expect(await GET()).toEqual({ rules: [], oneOffIds: Array.from({ length: 1001 }, (_, i) => `payment:${i}`) });
});
it('round-trips reviewed matching and rejects a stream claimed by another schedule', async () => {
  const matched = { ...rule, matchStreamKeys: ['new-description'] };
  expect(await PUT(request({ type: 'recurring', rule: matched }))).toEqual({ ok: true });
  expect(await GET()).toEqual({ rules: [matched], oneOffIds: [] });
  expect(await PUT(request({ type: 'recurring', rule: { ...rule, streamKey: 'manual:other', matchStreamKeys: ['new-description'] } }))).toMatchObject({ status: 409 });
  expect(await PUT(request({ type: 'recurring', rule: { ...matched, amount: 400 } }))).toEqual({ ok: true });
});
