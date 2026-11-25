import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "./route";
import { TOOL_NAMES, WRITE_TOOL_NAMES } from "@floaters/mcp-tools";

const WRITE_SECRET = "write-secret-with-enough-length";
const SECRET = "test-secret-with-enough-length";

function rpc(secret: string, body: unknown, method = "POST"): [NextRequest, { params: Promise<{ secret: string }> }] {
  const req = new NextRequest(`http://localhost:3000/mcp/${secret}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  return [req, { params: Promise.resolve({ secret }) }];
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
};

describe("/mcp/[secret]", () => {
  const original = process.env.MCP_SECRET;
  const originalWrite = process.env.MCP_WRITE_SECRET;
  beforeEach(() => {
    process.env.MCP_SECRET = SECRET;
    process.env.MCP_WRITE_SECRET = WRITE_SECRET;
  });
  afterEach(() => {
    process.env.MCP_SECRET = original;
    process.env.MCP_WRITE_SECRET = originalWrite;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("404s on the wrong secret", async () => {
    const res = await POST(...rpc("nope-nope-nope-nope-nope", initialize));
    expect(res.status).toBe(404);
  });

  it("404s everywhere when MCP_SECRET is unset or too short", async () => {
    delete process.env.MCP_SECRET;
    expect((await POST(...rpc(SECRET, initialize))).status).toBe(404);
    process.env.MCP_SECRET = "short";
    expect((await POST(...rpc("short", initialize))).status).toBe(404);
  });

  it("answers initialize as the floaters server, stateless, never cached", async () => {
    const res = await POST(...rpc(SECRET, initialize));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("mcp-session-id")).toBeNull();
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("floaters");
    expect(body.result.capabilities.tools).toBeDefined();
  });

  it("lists read and write tools on the original endpoint", async () => {
    const res = await POST(...rpc(SECRET, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES, ...WRITE_TOOL_NAMES].sort());
  });

  it("rejects the SSE stream GET in stateless mode rather than hanging", async () => {
    const res = await GET(...rpc(SECRET, undefined, "GET"));
    expect(res.status).toBe(405);
  });

  const call = async (secret: string, name: string, args: unknown) => {
    const response = await POST(...rpc(secret, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }));
    return await response.json();
  };
  const uuid = '12345678-1234-4234-8234-123456789abc';

  it('executes a write through the original URL with no separate write credential', async () => {
    delete process.env.MCP_WRITE_SECRET;
    const fetchMock = vi.fn(async (_url: URL, _init: RequestInit) => Response.json({ id: uuid, clientLabel: 'Example', amount: 100 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await call(SECRET, 'create_income_projection', { clientLabel: 'Example', amount: 100, expectedMonth: '2030-01' });
    expect(result.result.isError).not.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0].pathname).toBe('/api/projections');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    const rejected = await POST(...rpc('wrong-secret-with-enough-length', { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'create_income_projection', arguments: { clientLabel: 'Example', amount: 100, expectedMonth: '2030-01' } } }));
    expect(rejected.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('keeps the previously issued write URL working with the same tools and operation hints', async () => {
    const res = await POST(...rpc(WRITE_SECRET, { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    const listed = (await res.json()).result.tools;
    expect(listed.map((tool: { name: string }) => tool.name).sort()).toEqual([...TOOL_NAMES, ...WRITE_TOOL_NAMES].sort());
    expect(listed.find((tool: { name: string }) => tool.name === 'create_income_projection').annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false, destructiveHint: false });
    expect(listed.find((tool: { name: string }) => tool.name === 'delete_income_projection').annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    delete process.env.MCP_WRITE_SECRET;
    expect((await POST(...rpc(WRITE_SECRET, initialize))).status).toBe(404);
    process.env.MCP_WRITE_SECRET = SECRET;
    const collision = await POST(...rpc(SECRET, { jsonrpc: '2.0', id: 1, method: 'tools/list' }));
    expect((await collision.json()).result.tools.map((tool: { name: string }) => tool.name)).toEqual([...TOOL_NAMES, ...WRITE_TOOL_NAMES]);
    process.env.MCP_WRITE_SECRET = WRITE_SECRET;
    vi.stubEnv('CONNECT_SECRET', WRITE_SECRET);
    expect((await POST(...rpc(WRITE_SECRET, initialize))).status).toBe(404);
  });

  it('executes all forecast mutations through the authenticated API with correctly shaped payloads', async () => {
    vi.stubEnv('CONNECT_SECRET', 'test-api-key');
    const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
      if (init.method === 'GET' && url.pathname === '/api/projection-overrides') return Response.json({ overrides: [{ accountCode: '610 + rent', month: '2030-02', amount: 750 }] });
      if (init.method === 'GET' && url.pathname === '/api/hidden-accounts') return Response.json({ hiddenAccounts: ['610 + rent'] });
      return Response.json({ ok: true, id: uuid });
    });
    vi.stubGlobal('fetch', fetchMock);
    const cases: [string, object, string, string, unknown][] = [
      ['create_income_projection', { clientLabel: 'Example', amount: 1200, expectedMonth: '2030-02', recurrenceCount: 12 }, '/api/projections', 'POST', { clientLabel: 'Example', amount: 1200, expectedMonth: '2030-02', recurrenceCount: 12 }],
      ['update_income_projection', { id: uuid, patch: { amount: 900 } }, `/api/projections/${uuid}`, 'PATCH', { amount: 900 }],
      ['delete_income_projection', { id: uuid }, `/api/projections/${uuid}`, 'DELETE', undefined],
      ['set_cost_override', { accountCode: '610 + rent', month: '2030-02', amount: 750 }, '/api/projection-overrides', 'PUT', { accountCode: '610 + rent', month: '2030-02', amount: 750 }],
      ['remove_cost_override', { accountCode: '610 + rent', month: '2030-02' }, '/api/projection-overrides', 'DELETE', undefined],
      ['update_invoice_forecast', { invoiceId: uuid, patch: { expectedPaymentDate: '2030-02-15', projectionId: null, reviewed: false } }, `/api/adjustments/${uuid}`, 'PATCH', { expected_payment_date: '2030-02-15', projectionId: null, reviewed: false }],
      ['set_cost_account_hidden', { accountCode: '610 + rent', hidden: true }, '/api/hidden-accounts', 'POST', { accountCode: '610 + rent' }],
      ['save_cost_forecast_rule', { change: { type: 'one_off', transactionId: 'existing-payment' } }, '/api/cost-settings', 'PUT', { type: 'one_off', transactionId: 'existing-payment' }],
      ['remove_cost_forecast_rule', { decision: { type: 'dismissed', streamKey: 'existing-stream' } }, '/api/cost-settings', 'DELETE', undefined],
    ];
    for (const [tool, args, path, method, body] of cases) {
      fetchMock.mockClear();
      const result = await call(SECRET, tool, args);
      expect(result.result.isError, tool).not.toBe(true);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url.pathname, tool).toBe(path);
      expect(init.method, tool).toBe(method);
      expect(init.body === undefined ? undefined : JSON.parse(init.body as string), tool).toEqual(body);
      expect(init.headers).toMatchObject({ Authorization: 'Bearer test-api-key' });
      expect(init.cache).toBe('no-store');
      expect(init.redirect).toBe('error');
      if (tool === 'remove_cost_override') expect(url.searchParams.get('accountCode')).toBe('610 + rent');
      if (tool === 'remove_cost_forecast_rule') expect(Object.fromEntries(url.searchParams)).toEqual({ type: 'dismissed', streamKey: 'existing-stream' });
    }
  });

  it('validates identifiers, months, amounts, patches and schedule ranges before any API call', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const cases: [string, object][] = [
      ['create_income_projection', { clientLabel: 'Example', amount: -1, expectedMonth: '2030-01' }],
      ['create_income_projection', { clientLabel: 'Example', amount: 1, expectedMonth: '2030-13' }],
      ['update_income_projection', { id: uuid, patch: {} }],
      ['update_income_projection', { id: uuid, patch: { arbitrary: true } }],
      ['delete_income_projection', { id: '../../sync' }],
      ['update_invoice_forecast', { invoiceId: uuid, patch: { expectedPaymentDate: '2030-02-30' } }],
      ['set_cost_override', { accountCode: '610', month: '2030-01', amount: -1 }],
      ['save_cost_forecast_rule', { change: { type: 'recurring', rule: { accountCode: '610', streamKey: 's', label: 'Example', amount: 1, frequencyMonths: 1, startMonth: '2030-02', endMonth: '2030-01' } } }],
    ];
    for (const [name, args] of cases) expect((await call(SECRET, name, args)).result.isError, name).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns tool errors for API rejection or failed read-back, without reporting a successful save', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Schedule already claimed', { status: 409 })));
    const failed = await call(SECRET, 'save_cost_forecast_rule', { change: { type: 'one_off', transactionId: 'p' } });
    expect(failed.result.isError).toBe(true);
    expect(failed.result.content[0].text).toContain('409');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ overrides: [] })));
    const mismatch = await call(SECRET, 'set_cost_override', { accountCode: '610', month: '2030-01', amount: 100 });
    expect(mismatch.result.isError).toBe(true);
    expect(mismatch.result.content[0].text).toContain('may have been applied');
  });

  it('passes temporary exclusion arrays as repeated query parameters, with no mutation', async () => {
    const fetchMock = vi.fn(async () => Response.json({ months: [] })); vi.stubGlobal('fetch', fetchMock);
    await call(SECRET, 'get_cashflow', { monthsBack: 0, monthsForward: 2, excludeCost: ['610', '611'], excludeClient: ['label:example'] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.getAll('excludeCost')).toEqual(['610', '611']);
    expect(url.searchParams.getAll('excludeClient')).toEqual(['label:example']);
    expect(init.method).toBe('GET');
  });

});
