import { NextRequest } from 'next/server';
import { z } from 'zod/v4';
import { retirementPlanErrors, type RetirementPlan, type RetirementSavedPlan } from '@floaters/types';
import { AuthError, error, handleError, json, requireConnection } from '@/lib/api-helpers';
import { supabase } from '@/lib/supabase';
import { parseRetirementDescription, retirementDescription, retirementScenarioId, RETIREMENT_BODY_LIMIT } from '@/lib/retirement';

const retirementPlanSchema = z.unknown().superRefine((value, context) => {
  for (const message of retirementPlanErrors(value)) context.addIssue({ code: 'custom', message });
}).transform(value => value as RetirementPlan);

class BodyError extends Error {
  constructor(message: string, readonly status: 400 | 413) { super(message); }
}

async function readBody(request: NextRequest): Promise<unknown> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && Number(declaredLength) > RETIREMENT_BODY_LIMIT) throw new BodyError('Retirement plan exceeds 100KB', 413);
  if (!request.body) throw new BodyError('A retirement plan is required', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > RETIREMENT_BODY_LIMIT) {
        await reader.cancel();
        throw new BodyError('Retirement plan exceeds 100KB', 413);
      }
      chunks.push(chunk.value);
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)));
    } catch {
      throw new BodyError('Invalid retirement plan JSON', 400);
    }
  } finally {
    reader.releaseLock();
  }
}

export async function GET() {
  try {
    const connectionId = await requireConnection();
    const { data, error: dbError } = await supabase.from('scenarios')
      .select('description, updated_at')
      .eq('id', retirementScenarioId(connectionId))
      .eq('connection_id', connectionId)
      .maybeSingle();
    if (dbError) return error('Could not load retirement plan', 500);
    const saved: RetirementSavedPlan = data
      ? { plan: parseRetirementDescription(data.description), savedAt: data.updated_at ?? null }
      : { plan: null, savedAt: null };
    return json(saved);
  } catch (err) {
    // handleError logs non-auth errors, which may contain private plan/DB data.
    if (err instanceof AuthError) return handleError(err);
    return error('Could not load retirement plan', 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const body = await readBody(request);
    const parsed = retirementPlanSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid retirement plan', details: parsed.error.issues.map(issue => issue.message) }, 400);
    const plan = parsed.data;
    const savedAt = new Date().toISOString();
    const { error: dbError } = await supabase.from('scenarios').upsert({
      id: retirementScenarioId(connectionId),
      connection_id: connectionId,
      name: 'Retirement plan',
      description: retirementDescription(plan),
      is_active: false,
      updated_at: savedAt,
    }, { onConflict: 'id' });
    if (dbError) return error('Could not save retirement plan', 500);
    return json<RetirementSavedPlan>({ plan, savedAt });
  } catch (err) {
    if (err instanceof AuthError) return handleError(err);
    if (err instanceof BodyError) return error(err.message, err.status);
    return error('Could not save retirement plan', 500);
  }
}
