import { z } from 'zod/v4';
import type { CostSettings } from '@floaters/types';
import { supabase } from './supabase';

const month = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/);
const key = z.string().min(1).max(300);
const ruleSchema = z.object({
  accountCode: z.string().min(1).max(100), streamKey: key, label: z.string().trim().min(1).max(200),
  amount: z.number().finite().min(0).max(1_000_000_000),
  frequencyMonths: z.union([z.literal(1), z.literal(3), z.literal(12)]),
  startMonth: month, endMonth: month.nullable(),
  matchStreamKeys: z.array(key).max(50).optional(),
}).strict().refine(r => !r.endMonth || r.endMonth >= r.startMonth, 'End month must follow start month');

export const costChangeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('recurring'), rule: ruleSchema }).strict(),
  z.object({ type: z.literal('one_off'), transactionId: key }).strict(),
]);
export const costDeleteSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('recurring'), streamKey: key }).strict(),
  z.object({ type: z.literal('one_off'), transactionId: key }).strict(),
]);

export async function loadCostSettings(connectionId: string): Promise<CostSettings> {
  const settings: CostSettings = { rules: [], oneOffIds: [] };
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('cost_forecast_rules').select('rule').eq('connection_id', connectionId)
      .order('rule_key', { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw new Error('Could not load cost forecast settings');
    for (const row of data ?? []) {
      const parsed = costChangeSchema.safeParse(row.rule);
      if (!parsed.success) throw new Error('Invalid stored cost forecast settings');
      if (parsed.data.type === 'recurring') settings.rules.push(parsed.data.rule);
      else settings.oneOffIds.push(parsed.data.transactionId);
    }
    if ((data?.length ?? 0) < pageSize) break;
  }
  return settings;
}
