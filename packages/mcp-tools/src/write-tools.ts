import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ApiGet, ApiWrite } from './client';
import { ok, fail } from './result';

export const WRITE_TOOL_NAMES = [
  'create_income_projection', 'update_income_projection', 'delete_income_projection',
  'set_cost_override', 'remove_cost_override', 'update_invoice_forecast',
  'set_cost_account_hidden', 'save_cost_forecast_rule', 'remove_cost_forecast_rule',
] as const;

const month = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/).describe('Calendar month YYYY-MM.');
const id = z.string().uuid().describe('Exact record UUID from Floaters; never invent an ID.');
const accountCode = z.string().trim().min(1).max(100).describe('Exact cost account code from get_cashflow.');
const key = z.string().min(1).max(300);
const projection = {
  clientLabel: z.string().trim().min(1).max(200),
  amount: z.number().finite().positive().describe('Total GBP including VAT, not the amount to add to an existing total.'),
  expectedMonth: month,
  contactId: id.nullable().optional().describe('Existing Xero contact UUID, or null for a label-only client.'),
  recurrenceCount: z.number().int().min(1).max(120).optional().describe('Monthly occurrences including the first; 1 means one-off.'),
  escalationPct: z.number().finite().min(0).max(1000).optional().describe('Percent increase every escalationEvery occurrences.'),
  escalationEvery: z.number().int().min(1).max(120).nullable().optional(),
};
const annotations = (destructive = true, idempotent = true) => ({ readOnlyHint: false, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: false });
const attempt = async (run: () => Promise<unknown>) => { try { return ok(await run()); } catch (error) { return fail(error); } };

export function registerWriteTools(server: McpServer, get: ApiGet, write: ApiWrite) {
  server.registerTool('create_income_projection', {
    title: 'Create income projection',
    description: 'Use when asked to add expected client income, including monthly recurring income. Creates a Floaters forecast only, not a Xero invoice or payment. Amount is VAT-inclusive GBP. Read get_income_pipeline first to avoid duplicates. Creation is not idempotent: if a response is uncertain, inspect the pipeline before retrying.',
    inputSchema: projection, annotations: annotations(false, false),
  }, input => attempt(() => write('/api/projections', 'POST', input)));

  server.registerTool('update_income_projection', {
    title: 'Update income projection',
    description: 'Use when asked to change, re-date or resize an existing income projection. Read get_income_pipeline for the UUID and current values first. Supplied fields replace existing values; changing a recurring projection changes the whole series. Leaves Xero records unchanged.',
    inputSchema: { id, patch: z.object(projection).partial().strict().refine(p => Object.keys(p).length > 0, 'Provide at least one changed field') }, annotations: annotations(),
  }, ({ id, patch }) => attempt(() => write(`/api/projections/${encodeURIComponent(id)}`, 'PATCH', patch)));

  server.registerTool('delete_income_projection', {
    title: 'Delete income projection',
    description: 'Use when asked to remove an income projection. Deletes the whole recurring series, releases linked invoices to standalone, and leaves Xero invoices/payments and invoice review status unchanged. Read get_income_pipeline to identify the exact UUID first.',
    inputSchema: { id }, annotations: annotations(),
  }, ({ id }) => attempt(() => write(`/api/projections/${encodeURIComponent(id)}`, 'DELETE')));

  server.registerTool('set_cost_override', {
    title: 'Set monthly cost forecast total',
    description: 'Use when asked to set a cost account forecast for one month. Amount is a VAT-inclusive GBP month total, not extra spending. Known cash and bills remain the minimum; 0 cannot remove actual payments. Only affects Floaters. Use get_forecast_settings to read the previous override.',
    inputSchema: { accountCode, month, amount: z.number().finite().min(0) }, annotations: annotations(),
  }, input => attempt(async () => {
    await write('/api/projection-overrides', 'PUT', input);
    const saved = await get<{ overrides: { accountCode: string; month: string; amount: number }[] }>('/api/projection-overrides');
    const match = saved.overrides.find(row => row.accountCode === input.accountCode && row.month === input.month);
    if (!match || match.amount !== input.amount) throw new Error('Could not verify the saved override. Reload settings before retrying; the change may have been applied.');
    return { saved: match };
  }));

  server.registerTool('remove_cost_override', {
    title: 'Remove monthly cost override',
    description: 'Use when asked to restore the automatic forecast for one cost account/month. Removes only its saved manual override, never actual cash, bills or the account itself.',
    inputSchema: { accountCode, month }, annotations: annotations(),
  }, input => attempt(() => write('/api/projection-overrides', 'DELETE', undefined, input)));

  server.registerTool('update_invoice_forecast', {
    title: 'Update local invoice forecast or review',
    description: 'Use when asked to change a local expected payment date, review an invoice, or assign/unassign it to an income projection. Uses the Floaters invoice UUID from list_transactions/get_income_pipeline, not its invoice number or Xero ID. Assignment implies review; unassignment keeps it reviewed. A projection can only receive ACCREC income invoices. Does not change Xero or mark an invoice paid.',
    inputSchema: { invoiceId: id, patch: z.object({ expectedPaymentDate: z.string().date().optional(), projectionId: id.nullable().optional(), reviewed: z.boolean().optional() }).strict().refine(p => Object.keys(p).length > 0, 'Provide at least one changed field') }, annotations: annotations(),
  }, ({ invoiceId, patch: { expectedPaymentDate, ...patch } }) => attempt(() => write(`/api/adjustments/${encodeURIComponent(invoiceId)}`, 'PATCH', { ...patch, ...(expectedPaymentDate === undefined ? {} : { expected_payment_date: expectedPaymentDate }) })));

  server.registerTool('set_cost_account_hidden', {
    title: 'Hide or restore a cost account',
    description: 'Use when explicitly asked to save a cost row visibility change. This hides/restores the row in Floaters but its costs STILL COUNT in forecast totals. For a temporary what-if that excludes costs and recalculates balances, use get_cashflow with excludeCost instead; that does not save anything.',
    inputSchema: { accountCode, hidden: z.boolean() }, annotations: annotations(),
  }, ({ accountCode, hidden }) => attempt(async () => {
    await write('/api/hidden-accounts', hidden ? 'POST' : 'DELETE', hidden ? { accountCode } : undefined, hidden ? undefined : { accountCode });
    const saved = await get<{ hiddenAccounts: string[] }>('/api/hidden-accounts');
    if (saved.hiddenAccounts.includes(accountCode) !== hidden) throw new Error('Could not verify row visibility. Reload settings before retrying; the change may have been applied.');
    return { accountCode, hidden };
  }));

  const rule = z.object({ accountCode, streamKey: key, label: z.string().trim().min(1).max(200), amount: z.number().finite().min(0).max(1_000_000_000), frequencyMonths: z.union([z.literal(1), z.literal(3), z.literal(12)]), startMonth: month, endMonth: month.nullable(), matchStreamKeys: z.array(key).max(50).optional() }).strict().refine(r => !r.endMonth || r.endMonth >= r.startMonth, 'End month must follow start month');
  server.registerTool('save_cost_forecast_rule', {
    title: 'Save cost forecast decision',
    description: 'Use when explicitly asked to save or replace a recurring cost schedule, mark an existing payment as one-off, or dismiss a payment stream. Read get_cashflow costForecast and get_forecast_settings first; streamKey, transactionId and matchStreamKeys must be existing identifiers from those responses. Amounts include VAT. Training exclusions never delete known payments or bills. A selected stream cannot belong to two schedules. No Xero changes.',
    inputSchema: { change: z.discriminatedUnion('type', [z.object({ type: z.literal('recurring'), rule }).strict(), z.object({ type: z.literal('one_off'), transactionId: key }).strict(), z.object({ type: z.literal('dismissed'), stream: z.object({ accountCode, streamKey: key, label: z.string().trim().min(1).max(200) }).strict() }).strict()]) }, annotations: annotations(),
  }, ({ change }) => attempt(() => write('/api/cost-settings', 'PUT', change)));

  server.registerTool('remove_cost_forecast_rule', {
    title: 'Remove cost forecast decision',
    description: 'Use when asked to remove a saved recurring schedule or undo a one-off/dismissed classification. Read get_forecast_settings first. Removing a decision restores automatic estimation; known cash and bills are untouched.',
    inputSchema: { decision: z.discriminatedUnion('type', [z.object({ type: z.literal('one_off'), transactionId: key }).strict(), z.object({ type: z.enum(['recurring', 'dismissed']), streamKey: key }).strict()]) }, annotations: annotations(),
  }, ({ decision }) => attempt(() => write('/api/cost-settings', 'DELETE', undefined, decision)));
}
