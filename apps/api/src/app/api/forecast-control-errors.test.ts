import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({ fail: false, filters: [] as [string, unknown][] }));
vi.mock('@/lib/api-helpers', () => ({ requireConnection: async () => 'test-connection', json: (data: unknown, status = 200) => Response.json(data, { status }), error: (message: string, status = 400) => Response.json({ error: message }, { status }), handleError: (error: unknown) => { throw error; } }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => {
  const chain = {
    select: () => chain, delete: () => chain, order: () => chain,
    eq: (key: string, value: unknown) => { state.filters.push([key, value]); return chain; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: state.fail ? { message: 'Database unavailable' } : null }).then(resolve),
  };
  return chain;
} } }));
import { GET as projections } from './projections/route';
import { DELETE as deleteProjection } from './projections/[id]/route';
import { GET as overrides, DELETE as deleteOverride } from './projection-overrides/route';
import { GET as hidden, DELETE as restoreAccount } from './hidden-accounts/route';
const request = new NextRequest('https://example.test/api?accountCode=610&month=2030-01');
const calls = [
  () => projections(), () => overrides(), () => hidden(),
  () => deleteProjection(request, { params: Promise.resolve({ id: 'test-id' }) }),
  () => deleteOverride(request), () => restoreAccount(request),
];
beforeEach(() => { state.fail = false; state.filters = []; });
describe('forecast control database acknowledgements', () => {
  it.each(calls.map((run, i) => [i, run] as const))('surfaces database failure for control %i', async (_, run) => {
    state.fail = true;
    expect((await run()).status).toBe(500);
  });
  it.each(calls.map((run, i) => [i, run] as const))('keeps successful control %i scoped to the current connection', async (_, run) => {
    expect((await run()).status).toBe(200);
    expect(state.filters).toContainEqual(['connection_id', 'test-connection']);
  });
});
