import { createHash } from 'node:crypto';
import type { CostBreakdown, CostForecastReview, CostPayment, CostRule, CostSettings } from '@floaters/types';
import { addMonthKey } from './pipeline';
import { monthsBetween } from './runway';

const round = (n: number) => Math.round(n * 100) / 100;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

// Identity for saved dismissals and explicit schedule matching. Automatic
// forecasts learn account totals rather than individual payment descriptions.
export function costStreamKey(account: string, supplier: string, description: string): string {
  const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(JSON.stringify([account, normalise(supplier), normalise(description)])).digest('hex');
}

// Six complete months are enough to compare short-memory models, not to infer
// annual seasonality. Test each forecast using only observations available then.
function fitAccount(values: number[]): { method: string; error: number | null; forecast: (h: number) => number } {
  const median = (v: number[]) => {
    const sorted = [...v].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const mean = (v: number[]) => sum(v) / v.length;
  const methods = [
    { name: 'Recent spending level', predict: (v: number[], _h: number) => median(v.slice(-3)) },
    { name: 'Recent-weighted level', predict: (v: number[], _h: number) => {
      const recent = v.slice(-3);
      return sum(recent.map((x, i) => x * (i + 1))) / sum(recent.map((_, i) => i + 1));
    } },
    { name: '3-month average', predict: (v: number[], _h: number) => mean(v.slice(-3)) },
    { name: '6-month average', predict: (v: number[], _h: number) => mean(v) },
    { name: 'Latest spending level', predict: (v: number[], _h: number) => v[v.length - 1] },
    { name: 'Damped recent trend', predict: (history: number[], h: number) => {
      const v = history.slice(-6);
      const slopes = v.flatMap((x, i) => v.slice(i + 1).map((y, offset) => (y - x) / (offset + 1)));
      const slope = median(slopes);
      const movements = v.slice(1).map((x, i) => x - v[i]);
      if (v.length < 6 || slope === 0 || movements.filter(change => Math.sign(change) === Math.sign(slope)).length < 4) return median(v.slice(-3));
      const level = median(v.map((x, i) => x - slope * i)) + slope * (v.length - 1);
      return level + slope * sum(Array.from({ length: Math.min(h, 6) }, (_, i) => 0.8 ** (i + 1)));
    } },

  ];
  const predict = (method: typeof methods[number], history: number[], horizon: number) => {
    const amount = Math.max(0, method.predict(history, horizon));
    // A level model cannot carry an old high-cost regime above every recent
    // observation. Only a validated, sustained trend can extrapolate growth.
    return method.name === 'Damped recent trend' ? amount : Math.min(amount, Math.max(0, ...history.slice(-3)));
  };
  if (!values.length) return { method: 'No complete history', error: null, forecast: (_h: number) => 0 };
  if (values.length >= 3 && values.slice(-3).every(v => v === 0)) return { method: 'No spending in the last 3 months', error: null, forecast: (_h: number) => 0 };
  const enoughValidation = values.length >= 9;
  let selected = enoughValidation ? methods[0] : methods[2];
  const candidates = enoughValidation ? methods : values.slice(-6).length === 6 && values.slice(-6).every(v => v > 0) ? [methods[2], methods[1], methods[0]] : [];
  let bestError = Infinity;
  if (candidates.length) {
    for (const method of candidates) {
      const firstOrigin = values.length - 3;
      const errors = values.slice(firstOrigin).map((actual, i) => {
        const origin = firstOrigin + i;
        return (predict(method, values.slice(Math.max(0, origin - 6), origin), 1) - actual) ** 2;
      });
      // Squared errors retain an allowance for intermittent expenses rather than
      // rewarding a forecast of zero in every quiet month. Ties favour robustness.
      const error = enoughValidation ? Math.sqrt(mean(errors)) : mean(errors.map(Math.sqrt));
      if (error < bestError - 0.005) { selected = method; bestError = error; }
    }
  }
  if (enoughValidation) {
    const baseline = fitAccount(values.slice(-6));
    const baselineError = Math.sqrt(mean(values.slice(-3).map((actual, i) => {
      const origin = values.length - 3 + i;
      return (fitAccount(values.slice(origin - 6, origin)).forecast(1) - actual) ** 2;
    })));
    // Three validation months give little evidence: a challenger must reduce
    // error by more than 25% before displacing the established account baseline.
    if (bestError >= baselineError * 0.75) return { ...baseline, error: round(baselineError) };
  }
  const forecasts = Array.from({ length: 6 }, (_, i) => predict(selected, values.slice(-6), i + 1));
  return { method: selected.name, error: Number.isFinite(bestError) ? round(bestError) : null,
    forecast: (h: number) => forecasts[Math.max(1, Math.min(h, 6)) - 1] };
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
  const streams = new Map<string, { dismissed: boolean; accountCode: string; cash: CostPayment[]; bills: CostPayment[]; rule?: CostRule }>();
  const getStream = (key: string, accountCode: string) => {
    if (!streams.has(key)) streams.set(key, { dismissed: dismissed.has(JSON.stringify([accountCode, key])), accountCode, cash: [], bills: [] });
    return streams.get(key)!;
  };
  for (const p of input.cash) getStream(streamIdentity(p), p.accountCode).cash.push(p);
  for (const p of input.bills) getStream(streamIdentity(p), p.accountCode).bills.push(p);
  for (const rule of settings.rules) getStream(rule.streamKey, rule.accountCode).rule = rule;
  const accountCodes = new Set([...streams.values()].map(s => s.accountCode));
  for (const code of overrides.keys()) accountCodes.add(code);
  const byAccount = new Map([...accountCodes].map(code => [code, [...streams.values()].filter(s => s.accountCode === code)]));
  const modelMonths = Array.from({ length: 9 }, (_, i) => addMonthKey(currentMonth, i - 9)).filter(m => m >= input.historyFromMonth);
  const historyMonths = modelMonths.slice(-6);
  const monthlyTotals = (payments: CostPayment[]) => {
    const totals = new Map<string, number>();
    for (const p of payments) {
      const month = p.date.slice(0, 7);
      totals.set(month, (totals.get(month) ?? 0) + p.amount);
    }
    return totals;
  };
  const actualHistory = new Map([...byAccount].map(([code, accountStreams]) => [code, monthlyTotals(accountStreams.flatMap(s => s.cash))]));
  const automatic = new Map([...byAccount].map(([code, accountStreams]) => {
    const training = accountStreams.filter(s => !s.rule && !s.dismissed).flatMap(s => s.cash).filter(p => !oneOffs.has(p.id));
    const totals = monthlyTotals(training);
    const values = modelMonths.map(month => totals.get(month) ?? 0);
    return [code, fitAccount(values)];
  }));
  const review: CostForecastReview = {
    settings,
    suggestions: [],
    streams: [...new Map([...input.cash, ...input.bills].map(p => [p.streamKey, { streamKey: p.streamKey, accountCode: p.accountCode, label: p.label }])).values()],
    recentPayments: input.cash.filter(p => p.amount > 0).sort((a, b) => b.date.localeCompare(a.date)),
  };

  function estimate(accountCode: string, month: string, options: { excluded?: boolean; knownOnly?: boolean } = {}) {
    const breakdown: CostBreakdown = { actual: 0, bills: 0, recurring: 0, variable: 0, adjustment: 0, method: '' };
    const methods = new Set<string>();
    let automaticKnown = 0;
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
        automaticKnown += sum(cash.filter(p => !oneOffs.has(p.id) && p.amount > 0).map(p => p.amount))
          + sum(stream.bills.filter(p => p.date.slice(0, 7) === month && p.amount > 0).map(p => p.amount));
      }
    }
    if (month >= currentMonth && !options.excluded && !options.knownOnly) {
      const model = automatic.get(accountCode);
      breakdown.variable = Math.max(0, (model?.forecast(monthsBetween(currentMonth, month) + 1) ?? 0) - automaticKnown);
      if (model) methods.add(model.method);
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

  const nextMonth = addMonthKey(currentMonth, 1);
  review.accountForecasts = [...byAccount.keys()].map(accountCode => ({
    accountCode, history: historyMonths.map(month => ({ month, amount: round(actualHistory.get(accountCode)?.get(month) ?? 0) })),
    nextMonth, nextMonthAmount: estimate(accountCode, nextMonth).amount,
    method: automatic.get(accountCode)!.method, backtestError: automatic.get(accountCode)!.error,
  }));

  // Trends settle after six steps; after this boundary costs repeat annually.
  const changes = [addMonthKey(currentMonth, 5), ...input.bills.map(p => p.date.slice(0, 7)), ...settings.rules.flatMap(r => [r.startMonth, ...(r.endMonth ? [addMonthKey(r.endMonth, 1)] : [])]), ...[...overrides.values()].flatMap(months => [...months.keys()])];
  return { accountCodes, estimate, review, lastChangeMonth: changes.sort().at(-1)! };
}
