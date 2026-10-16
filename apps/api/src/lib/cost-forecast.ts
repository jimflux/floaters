import { createHash } from 'node:crypto';
import type { CostBreakdown, CostForecastReview, CostPayment, CostRule, CostSettings } from '@floaters/types';
import { addMonthKey } from './pipeline';
import { monthsBetween } from './runway';

const round = (n: number) => Math.round(n * 100) / 100;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

// Supplier + description + account: a bill replaces only the matching spend,
// never every other supplier in its chart-of-accounts category.
export function costStreamKey(account: string, supplier: string, description: string): string {
  const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(JSON.stringify([account, normalise(supplier), normalise(description)])).digest('hex');
}

function monthlyEstimate(payments: CostPayment[], currentMonth: string): { amount: number; method: string } {
  const totals = new Map<string, number>();
  for (const p of payments) {
    const month = p.date.slice(0, 7);
    if (month < currentMonth) totals.set(month, (totals.get(month) ?? 0) + p.amount);
  }
  const valuesBefore = (month: string) => [-3, -2, -1].map(offset => totals.get(addMonthKey(month, offset)) ?? 0);
  const methods = [
    { name: '3-month average', calculate: (v: number[]) => sum(v) / 3 },
    { name: 'Recent-weighted average', calculate: (v: number[]) => (v[0] + 2 * v[1] + 3 * v[2]) / 6 },
    { name: '3-month median', calculate: (v: number[]) => [...v].sort((a, b) => a - b)[1] },
  ];
  // Compare forecasts made before each of the last three complete months.
  // Sparse streams keep the simple baseline; zero months are real zeros,
  // not missing observations to drop from an average.
  const hasSixMonths = [-6, -5, -4, -3, -2, -1].every(offset => totals.has(addMonthKey(currentMonth, offset)));
  let selected = methods[0];
  if (hasSixMonths) {
    let bestError = Infinity;
    for (const method of methods) {
      const error = sum([-3, -2, -1].map(offset => {
        const month = addMonthKey(currentMonth, offset);
        return Math.abs(method.calculate(valuesBefore(month)) - (totals.get(month) ?? 0));
      }));
      if (error < bestError - 0.005) { selected = method; bestError = error; }
    }
  }
  return { amount: Math.max(0, round(selected.calculate(valuesBefore(currentMonth)))), method: selected.name };
}

export function createCostForecast(input: {
  currentMonth: string;
  historyFromMonth: string;
  cash: CostPayment[];
  bills: CostPayment[];
  settings: CostSettings;
  overrides: Map<string, Map<string, number>>;
}) {
  const { currentMonth, settings, overrides } = input;
  const oneOffs = new Set(settings.oneOffIds);
  const dismissed = new Set((settings.dismissedStreams ?? []).map(s => JSON.stringify([s.accountCode, s.streamKey])));
  const aliases = new Map<string, string>();
  for (const rule of settings.rules) {
    for (const key of new Set([rule.streamKey, ...(rule.matchStreamKeys ?? [])])) {
      const identity = JSON.stringify([rule.accountCode, key]);
      const owner = aliases.get(identity);
      if (owner && owner !== rule.streamKey) throw new Error('A payment stream belongs to more than one schedule');
      aliases.set(identity, rule.streamKey);
    }
  }
  const streamIdentity = (p: CostPayment) => aliases.get(JSON.stringify([p.accountCode, p.streamKey])) ?? p.streamKey;
  const streams = new Map<string, { dismissed: boolean; accountCode: string; label: string; cash: CostPayment[]; bills: CostPayment[]; rule?: CostRule; baseline: number; method: string }>();
  const getStream = (key: string, accountCode: string, label: string) => {
    if (!streams.has(key)) streams.set(key, { dismissed: dismissed.has(JSON.stringify([accountCode, key])), accountCode, label, cash: [], bills: [], baseline: 0, method: '' });
    return streams.get(key)!;
  };
  for (const p of input.cash) getStream(streamIdentity(p), p.accountCode, p.label).cash.push(p);
  for (const p of input.bills) getStream(streamIdentity(p), p.accountCode, p.label).bills.push(p);
  for (const rule of settings.rules) getStream(rule.streamKey, rule.accountCode, rule.label).rule = rule;
  for (const stream of streams.values()) {
    const estimate = monthlyEstimate(stream.cash.filter(p => !oneOffs.has(p.id) && p.date.slice(0, 7) >= input.historyFromMonth), currentMonth);
    stream.baseline = estimate.amount;
    stream.method = estimate.method;
  }
  const accountCodes = new Set([...streams.values()].map(s => s.accountCode));
  for (const code of overrides.keys()) accountCodes.add(code);
  const byAccount = new Map([...accountCodes].map(code => [code, [...streams.values()].filter(s => s.accountCode === code)]));
  const review: CostForecastReview = {
    settings,
    suggestions: [],
    streams: [...new Map([...input.cash, ...input.bills].map(p => [p.streamKey, { streamKey: p.streamKey, accountCode: p.accountCode, label: p.label }])).values()],
    recentPayments: input.cash.filter(p => p.amount > 0).sort((a, b) => b.date.localeCompare(a.date)),
  };
  for (const [key, stream] of streams) {
    if (stream.rule || stream.dismissed) continue;
    const payments = stream.cash.filter(p => p.amount > 0 && !oneOffs.has(p.id)).sort((a, b) => a.date.localeCompare(b.date));
    if (!payments.length || !stream.label || stream.label === 'Unspecified cost') continue;
    // Combine partial payments in a month before suggesting a repeating amount.
    const totals = new Map<string, number>();
    for (const p of payments) totals.set(p.date.slice(0, 7), (totals.get(p.date.slice(0, 7)) ?? 0) + p.amount);
    const months = [...totals.keys()];
    const gaps = months.slice(1).map((month, i) => monthsBetween(months[i], month));
    const cadence = gaps.length && gaps.every(g => g === 12) ? 12 : gaps.length && gaps.every(g => g === 3) ? 3 : 1;
    let next = addMonthKey(months[months.length - 1], cadence);
    while (next < currentMonth) next = addMonthKey(next, cadence);
    review.suggestions.push({ accountCode: stream.accountCode, streamKey: key, label: stream.label.slice(0, 200),
      amount: round(totals.get(months[months.length - 1])!), frequencyMonths: cadence,
      startMonth: next, endMonth: null, evidenceCount: payments.length,
      reason: months.length === 1 ? 'Only one month of payments. Check whether this repeats.' : `${payments.length} payments across ${months.length} months. Check the amount and frequency.` });
  }

  function estimate(accountCode: string, month: string, options: { excluded?: boolean; knownOnly?: boolean } = {}) {
    const breakdown: CostBreakdown = { actual: 0, bills: 0, recurring: 0, variable: 0, adjustment: 0, method: '' };
    const methods = new Set<string>();
    for (const stream of byAccount.get(accountCode) ?? []) {
      const cash = stream.cash.filter(p => p.date.slice(0, 7) === month);
      const actual = sum(cash.map(p => p.amount));
      breakdown.actual += actual;
      if (month < currentMonth || options.excluded) continue;
      const bills = sum(stream.bills.filter(p => p.date.slice(0, 7) === month).map(p => p.amount));
      breakdown.bills += bills;
      if (options.knownOnly) continue;
      const regularActual = sum(cash.filter(p => !oneOffs.has(p.id)).map(p => p.amount));
      if (stream.rule) {
        const r = stream.rule;
        const offset = monthsBetween(r.startMonth, month);
        const expected = offset >= 0 && offset % r.frequencyMonths === 0 && (!r.endMonth || month <= r.endMonth) ? r.amount : 0;
        // Refunds reduce cash, but do not imply an extra subscription is due.
        breakdown.recurring += Math.max(0, expected - Math.max(0, regularActual) - Math.max(0, bills));
        methods.add('Reviewed payment schedule');
      } else if (!stream.dismissed) {
        breakdown.variable += Math.max(0, stream.baseline - Math.max(0, regularActual) - Math.max(0, bills));
        methods.add(stream.method);
      }
    }
    for (const key of ['actual', 'bills', 'recurring', 'variable'] as const) breakdown[key] = round(breakdown[key]);
    const override = month >= currentMonth && !options.excluded && !options.knownOnly ? overrides.get(accountCode)?.get(month) : undefined;
    if (override !== undefined) {
      const target = Math.max(breakdown.actual + breakdown.bills, override);
      breakdown.adjustment = round(target - breakdown.actual - breakdown.bills - breakdown.recurring - breakdown.variable);
      methods.add('Manual month total (known cash and bills are the minimum)');
    }
    breakdown.method = month < currentMonth ? 'Recorded cash' : options.excluded ? 'Future costs excluded' : [...methods].join('; ') || 'Known cash and bills';
    const amount = round(breakdown.actual + breakdown.bills + breakdown.recurring + breakdown.variable + breakdown.adjustment);
    return { amount, breakdown, hasOverride: override !== undefined, isProjected: month > currentMonth || (month === currentMonth && amount !== breakdown.actual) };
  }

  // After this boundary, only the repeating 12-month schedule remains.
  const changes = [currentMonth, ...input.bills.map(p => p.date.slice(0, 7)), ...settings.rules.flatMap(r => [r.startMonth, ...(r.endMonth ? [addMonthKey(r.endMonth, 1)] : [])]), ...[...overrides.values()].flatMap(months => [...months.keys()])];
  return { accountCodes, estimate, review, lastChangeMonth: changes.sort().at(-1)! };
}
