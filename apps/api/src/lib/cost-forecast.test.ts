import { describe, expect, it } from 'vitest';
import type { CostPayment, CostRule } from '@floaters/types';
import { createCostForecast, costStreamKey } from './cost-forecast';

const payment = (id: string, date: string, amount: number, supplier = 'Software'): CostPayment => ({
  id, date, amount, accountCode: '400', streamKey: costStreamKey('400', supplier, 'Subscription'), label: supplier,
});
const rule = (overrides: Partial<CostRule> = {}): CostRule => ({
  accountCode: '400', streamKey: costStreamKey('400', 'Software', 'Subscription'), label: 'Software',
  amount: 300, frequencyMonths: 1, startMonth: '2026-06', endMonth: null, ...overrides,
});
const history = [payment('mar', '2026-03-10', 300), payment('apr', '2026-04-10', 300), payment('may', '2026-05-10', 300)];
function model(cash = history, bills: CostPayment[] = [], rules: CostRule[] = [], oneOffIds: string[] = [], overrides = new Map<string, Map<string, number>>()) {
  return createCostForecast({ currentMonth: '2026-06', historyFromMonth: '2025-06', cash, bills, settings: { rules, oneOffIds }, overrides });
}

describe('reviewable cost forecasts', () => {
  it('selects the better recent estimator using held-out complete months', () => {
    const cash = Array.from({ length: 6 }, (_, i) => payment(`p${i}`, `${i === 0 ? '2025-12' : `2026-0${i}`}-10`, (i + 1) * 100));
    const result = model(cash).estimate('400', '2026-07');
    expect(result.amount).toBe(533.33);
    expect(result.breakdown.method).toBe('Recent-weighted average');
  });
  it('retains other suppliers when one bill arrives, without duplicating the matching payment', () => {
    const cash = [...history, ...history.map(p => payment(`${p.id}-other`, p.date, 200, 'Other'))];
    const result = model(cash, [payment('bill', '2026-07-10', 320)]).estimate('400', '2026-07');
    expect(result.amount).toBe(520);
    expect(result.breakdown.bills).toBe(320);
    expect(result.breakdown.variable).toBe(200);
  });
  it('uses a confirmed new subscription amount rather than dividing one payment by three', () => {
    const forecast = model([history[2]], [], [rule()]);
    expect(forecast.estimate('400', '2026-07').amount).toBe(300);
    expect(forecast.review.suggestions).toEqual([]);
  });
  it('excludes only the marked one-off from training, preserving recorded cash', () => {
    const cash = [...history, payment('laptop', '2026-05-20', 3000)];
    const forecast = model(cash, [], [], ['laptop']);
    expect(forecast.estimate('400', '2026-05').amount).toBe(3300);
    expect(forecast.estimate('400', '2026-07').amount).toBe(300);
  });
  it('does not let a current one-off consume the regular monthly estimate', () => {
    const forecast = model([...history, payment('laptop', '2026-06-02', 3000)], [], [], ['laptop']);
    expect(forecast.estimate('400', '2026-06').amount).toBe(3300);
  });
  it('schedules annual costs in their payment month and stops after the end month', () => {
    const forecast = model(history, [], [rule({ amount: 1200, frequencyMonths: 12, startMonth: '2026-09', endMonth: '2027-09' })]);
    expect(forecast.estimate('400', '2026-08').amount).toBe(0);
    expect(forecast.estimate('400', '2026-09').amount).toBe(1200);
    expect(forecast.estimate('400', '2027-09').amount).toBe(1200);
    expect(forecast.estimate('400', '2028-09').amount).toBe(0);
  });
  it('counts a paid part and an unpaid bill once against a recurring estimate', () => {
    const forecast = model([...history, payment('part', '2026-06-10', 100)], [payment('rest', '2026-06-20', 200)], [rule()]);
    expect(forecast.estimate('400', '2026-06').amount).toBe(300);
    expect(forecast.estimate('400', '2026-06').breakdown.recurring).toBe(0);
  });
  it('treats overrides as month totals with known cash and bills as the floor', () => {
    const overrides = new Map([['400', new Map([['2026-06', 500], ['2026-07', 50]])]]);
    const forecast = model([...history, payment('paid', '2026-06-01', 100)], [payment('b1', '2026-06-20', 200), payment('b2', '2026-07-20', 200)], [], [], overrides);
    expect(forecast.estimate('400', '2026-06').amount).toBe(500);
    expect(forecast.estimate('400', '2026-07').amount).toBe(200);
    expect(forecast.estimate('400', '2026-07').hasOverride).toBe(true);
  });
  it('suggests recurrence without automatically applying a schedule', () => {
    const forecast = model([history[2]]);
    expect(forecast.review.suggestions[0]).toMatchObject({ amount: 300, evidenceCount: 1, frequencyMonths: 1 });
    expect(forecast.estimate('400', '2026-07').amount).toBe(100);
  });
  it('preserves signed refunds and reconciles every component', () => {
    const forecast = model(history, [payment('refund', '2026-07-01', -40)], [rule()]);
    const result = forecast.estimate('400', '2026-07');
    expect(result.amount).toBe(260);
    const { actual, bills, recurring, variable, adjustment } = result.breakdown;
    expect(actual + bills + recurring + variable + adjustment).toBe(result.amount);
  });
  it('temporary exclusions remove future costs but retain actual history and cash to date', () => {
    const forecast = model([...history, payment('paid', '2026-06-01', 100)], [], [rule()]);
    expect(forecast.estimate('400', '2026-05', { excluded: true }).amount).toBe(300);
    expect(forecast.estimate('400', '2026-06', { excluded: true }).amount).toBe(100);
    expect(forecast.estimate('400', '2026-07', { excluded: true }).amount).toBe(0);
  });
});

it('keeps a current one-off additional to a confirmed recurring schedule', () => {
  const forecast = model([...history, payment('laptop', '2026-06-02', 3000)], [], [rule()], ['laptop']);
  expect(forecast.estimate('400', '2026-06')).toMatchObject({ amount: 3300, breakdown: { actual: 3000, recurring: 300 } });
});
it('reconciles changing descriptions only after the user explicitly matches them', () => {
  const cash = history.map((p, i) => ({ ...p, streamKey: `description-${i}` }));
  const bill = { ...payment('june', '2026-06-20', 300), streamKey: 'description-june' };
  expect(model(cash, [bill]).estimate('400', '2026-06').amount).toBe(600);
  const matched = rule({ streamKey: cash[0].streamKey, matchStreamKeys: [cash[1].streamKey, cash[2].streamKey, bill.streamKey] });
  const forecast = model(cash, [bill], [matched]);
  expect(forecast.estimate('400', '2026-06')).toMatchObject({ amount: 300, breakdown: { bills: 300, recurring: 0, variable: 0 } });
  expect(forecast.estimate('400', '2026-07').amount).toBe(300);
  expect(forecast.review.suggestions).toEqual([]);
  expect(forecast.review.streams).toHaveLength(4);
  const other = payment('other', '2026-06-20', 200, 'Other supplier');
  expect(model(cash, [bill, other], [matched]).estimate('400', '2026-06').amount).toBe(500);
});
it('links an additional planned cost to its first imported bill without changing its schedule', () => {
  const bill = payment('first', '2026-06-20', 300);
  const forecast = model([], [bill], [rule({ streamKey: 'manual:planned', matchStreamKeys: [bill.streamKey] })]);
  expect(forecast.estimate('400', '2026-06').amount).toBe(300);
  expect(forecast.estimate('400', '2026-07').amount).toBe(300);
});
it('fails visibly rather than double counting if concurrent saves claim the same payment', () => {
  expect(() => model([], [], [rule(), rule({ streamKey: 'manual:other', matchStreamKeys: [rule().streamKey] })])).toThrow('more than one schedule');
});
it('keeps suggested labels within the saved rule limit without changing stream identity', () => {
  const p = { ...history[2], label: 'Very long description '.repeat(30) };
  expect(model([p]).review.suggestions[0]).toMatchObject({ label: p.label.slice(0, 200), streamKey: p.streamKey });
});
