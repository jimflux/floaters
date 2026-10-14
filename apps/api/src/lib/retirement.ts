import { createHash } from 'node:crypto';
import { retirementPlanErrors, type RetirementPlan } from '@floaters/types';

export const RETIREMENT_BODY_LIMIT = 100 * 1024;
const KIND = 'floaters-retirement';

/** RFC 4122 UUIDv5 under the DNS namespace, reserved per Floaters connection. */
export function retirementScenarioId(connectionId: string): string {
  const hash = createHash('sha1')
    .update(Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex'))
    .update(`floaters.retirement.v1:${connectionId}`)
    .digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function retirementDescription(plan: RetirementPlan): string {
  return JSON.stringify({ kind: KIND, version: 1, plan });
}

export function parseRetirementDescription(description: unknown): RetirementPlan {
  if (typeof description !== 'string' || Buffer.byteLength(description, 'utf8') > RETIREMENT_BODY_LIMIT + 256) throw new Error('Invalid stored plan');
  const envelope: unknown = JSON.parse(description);
  if (!envelope || typeof envelope !== 'object' || !('kind' in envelope) || envelope.kind !== KIND || !('version' in envelope) || envelope.version !== 1 || !('plan' in envelope) || retirementPlanErrors(envelope.plan).length) throw new Error('Invalid stored plan');
  return envelope.plan as RetirementPlan;
}
