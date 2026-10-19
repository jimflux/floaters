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
  it('learns a bounded trend using held-out complete months', () => {
    const cash = ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'].map((month, i) => payment(`p${i}`, `${month}-10`, (i + 1) * 100));
    const forecast = model(cash);
    const result = forecast.estimate('400', '2026-07');
    // Held-out trend errors are £20 each, versus £166.67 for the baseline.
    expect(forecast.review.accountForecasts?.[0].backtestError).toBe(20);
    expect(result.amount).toBe(1044);
    expect(result.breakdown.method).toBe('Damped recent trend');
  });
  it.each([
    { label: 'a modest validation gain', values: [200, 300, 300, 200, 200, 300, 300, 200, 300], method: '3-month average', amount: 266.67, error: 64.55 },
    { label: 'exactly a 25% validation gain', values: [200, 100, 200, 100, 100, 200, 200, 100, 100], method: 'Recent-weighted level', amount: 116.67, error: 66.67 },
  ])('retains the established forecast for $label', ({ values, method, amount, error }) => {
    const months = ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
    const forecast = model(months.map((month, i) => payment(`validation-${i}`, `${month}-10`, values[i])));
    // Case 1: baseline validation errors [200/3, -250/3, 100/3], RMSE 64.55;
    // six-month challenger errors [50, -200/3, 50], RMSE 56.11 (~13% gain).
    // Case 2: baseline errors [200/3, -200/3, -200/3], RMSE 66.67;
    // challenger errors [50, -50, -50], RMSE 50 (exactly 25% gain).
    // A replacement must improve by more than 25%, even at the boundary.
    expect(forecast.review.accountForecasts?.[0]).toMatchObject({ method, backtestError: error });
    expect(forecast.estimate('400', '2026-07')).toMatchObject({ amount, breakdown: { method } });
  });
  it('counts known bills toward the account forecast rather than adding them twice', () => {
    const cash = [...history, ...history.map(p => payment(`${p.id}-other`, p.date, 200, 'Other'))];
    const result = model(cash, [payment('bill', '2026-07-10', 320)]).estimate('400', '2026-07');
    expect(result.amount).toBe(500);
    expect(result.breakdown.bills).toBe(320);
    expect(result.breakdown.variable).toBe(180);
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
  it('budgets recent spending without a review task and drops it after three complete quiet months', () => {
    const forecast = model([history[2]]);
    expect(forecast.review.suggestions).toEqual([]);
    expect(forecast.estimate('400', '2026-07').amount).toBe(100);
    const later = createCostForecast({ currentMonth: '2026-09', historyFromMonth: '2025-09', cash: [history[2]], bills: [], settings: { rules: [], oneOffIds: [] }, overrides: new Map() });
    expect(later.estimate('400', '2026-10').amount).toBe(0);
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
it('learns account spending across descriptions while retaining explicit manual matching', () => {
  const cash = history.map((p, i) => ({ ...p, streamKey: `description-${i}` }));
  const bill = { ...payment('june', '2026-06-20', 300), streamKey: 'description-june' };
  expect(model(cash, [bill]).estimate('400', '2026-06').amount).toBe(300);
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

it('stops estimating a dismissed stream, keeps known cash and bills, and restores its estimate on undo', () => {
  const { accountCode, streamKey, label } = rule();
  const cash = [...history, ...history.map(p => payment(`${p.id}-other`, p.date, 200, 'Other')), payment('paid', '2026-06-01', 100)];
  const build = (dismissed = true, rules: CostRule[] = [], overrides = new Map<string, Map<string, number>>()) => createCostForecast({
    currentMonth: '2026-06', historyFromMonth: '2025-06', cash,
    bills: [payment('june-bill', '2026-06-20', 50), payment('july-bill', '2026-07-20', 40)],
    settings: { rules, oneOffIds: [], dismissedStreams: dismissed ? [{ accountCode, streamKey, label }] : [] }, overrides,
  });
  const dismissed = build();
  expect(dismissed.review.suggestions).toEqual([]);
  expect(dismissed.estimate('400', '2026-05').amount).toBe(500);
  expect(dismissed.estimate('400', '2026-06').amount).toBe(350);
  expect(dismissed.estimate('400', '2026-07')).toMatchObject({ amount: 240, breakdown: { bills: 40, variable: 200 } });
  expect(build(false).estimate('400', '2026-07').amount).toBe(500);
  expect(build(true, [rule()]).estimate('400', '2026-07').amount).toBe(500);
  expect(build(true, [], new Map([['400', new Map([['2026-07', 600]])]])).estimate('400', '2026-07').amount).toBe(600);
});


describe('automatic account forecasts', () => {
  const forecast = (values: number[], extra: CostPayment[] = [], historyFromMonth = '2025-10') => createCostForecast({
    currentMonth: '2026-07', historyFromMonth,
    cash: [...values.flatMap((amount, i) => amount ? [{ ...payment(`m${i}`, `2026-0${i + 1}-10`, amount), streamKey: `different-description-${i}` }] : []), ...extra],
    bills: [], settings: { rules: [], oneOffIds: [] }, overrides: new Map(),
  });
  it('learns one category across changing descriptions without producing a review queue', () => {
    const result = forecast([100, 100, 100, 100, 100, 100]);
    expect(result.estimate('400', '2026-08').amount).toBe(100);
    expect(result.review.suggestions).toEqual([]);
    expect(result.review.accountForecasts).toHaveLength(1);
    expect(result.review.accountForecasts?.[0]).toMatchObject({ accountCode: '400', nextMonth: '2026-08', nextMonthAmount: 100 });
  });
  it('keeps a recent large expense in the baseline when there is no evidence that it was a one-off', () => {
    expect(forecast([100, 100, 100, 100, 100, 10000]).estimate('400', '2026-08').amount).toBe(3400);
  });
  it('adapts to a stopped cost and a sustained new spending level', () => {
    expect(forecast([100, 100, 100, 0, 0, 0]).estimate('400', '2026-08').amount).toBe(0);
    expect(forecast([100, 100, 100, 200, 200, 200]).estimate('400', '2026-08').amount).toBe(200);
  });
  it('retains a nonzero allowance for intermittent account spending and real zero months', () => {
    const result = forecast([300, 0, 0, 300, 0, 0]);
    expect(result.estimate('400', '2026-08').amount).toBeGreaterThan(0);
    expect(result.estimate('400', '2026-08').amount).toBeLessThan(300);
    expect(result.review.accountForecasts?.[0].history.map(p => p.amount)).toEqual([300, 0, 0, 300, 0, 0]);
  });
  it('does not extrapolate patchy spending into continuing growth', () => {
    const result = forecast([0, 500, 0, 1000, 0, 3000]);
    expect(result.estimate('400', '2027-06').amount).toBeLessThanOrEqual(3000);
    expect(result.estimate('400', '2027-06').breakdown.method).not.toContain('Damped recent trend');
  });
  it('uses only complete available months, without current-month or old-history leakage', () => {
    const extra = [payment('old', '2025-09-01', 90000), payment('partial', '2026-07-01', 90000)];
    expect(forecast([100, 100, 100, 100, 100, 100], extra).estimate('400', '2026-08').amount).toBe(100);
    expect(forecast([0, 0, 0, 0, 100, 100], [], '2026-05').estimate('400', '2026-08').amount).toBe(100);
  });
  it('dampens growing costs and settles before the repeating runway boundary', () => {
    const result = createCostForecast({ currentMonth: '2026-07', historyFromMonth: '2025-10',
      cash: ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].map((month, i) => payment(`trend-${i}`, `${month}-10`, (i + 1) * 100)),
      bills: [], settings: { rules: [], oneOffIds: [] }, overrides: new Map() });
    expect(result.estimate('400', '2026-07').amount).toBe(980);
    expect(result.estimate('400', '2026-08').amount).toBe(1044);
    expect(result.estimate('400', '2026-12').amount).toBeCloseTo(1195.14, 2);
    expect(result.estimate('400', '2027-12').amount).toBe(result.estimate('400', '2026-12').amount);
    expect(result.lastChangeMonth).toBe('2026-12');
  });
});
