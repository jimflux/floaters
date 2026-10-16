import { NextRequest } from 'next/server';
import { requireConnection, json, error, handleError } from '@/lib/api-helpers';
import { supabase } from '@/lib/supabase';
import { costChangeSchema, costDeleteSchema, loadCostSettings } from '@/lib/cost-settings';

export async function GET() {
  let connectionId: string;
  try { connectionId = await requireConnection(); } catch (err) { return handleError(err); }
  try { return json(await loadCostSettings(connectionId)); }
  catch { return error('Could not load cost forecast settings', 500); }
}

export async function PUT(request: NextRequest) {
  let connectionId: string;
  try { connectionId = await requireConnection(); } catch (err) { return handleError(err); }
  let body: unknown;
  try {
    if (!request.body) return error('A cost forecast decision is required', 400);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) { await reader.cancel(); return error('Cost forecast decision is too large', 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return error('Invalid cost forecast decision', 400); }
  const parsed = costChangeSchema.safeParse(body);
  if (!parsed.success) return error('Invalid cost forecast decision', 400);
  const change = parsed.data;
  const ruleKey = change.type === 'recurring' ? `recurring:${change.rule.streamKey}` : `one_off:${change.transactionId}`;
  try {
    const { data: saved, error: dbError } = await supabase.rpc('save_cost_forecast_rule', {
      p_connection_id: connectionId, p_rule_key: ruleKey, p_rule: change,
    });
    if (dbError) throw new Error('Save failed');
    if (saved === false) return error('A selected payment already belongs to another schedule', 409);
    return json({ ok: true });
  } catch { return error('Could not save cost forecast settings', 500); }
}

export async function DELETE(request: NextRequest) {
  let connectionId: string;
  try { connectionId = await requireConnection(); } catch (err) { return handleError(err); }
  const parsed = costDeleteSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return error('Invalid cost forecast decision', 400);
  const change = parsed.data;
  const ruleKey = change.type === 'recurring' ? `recurring:${change.streamKey}` : `one_off:${change.transactionId}`;
  try {
    const { error: dbError } = await supabase.from('cost_forecast_rules').delete().eq('connection_id', connectionId).eq('rule_key', ruleKey);
    if (dbError) throw new Error('Delete failed');
    return json({ ok: true });
  } catch { return error('Could not save cost forecast settings', 500); }
}
