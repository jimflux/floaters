import { describe, expect, it } from 'vitest';
import { createExampleRetirementPlan } from './retirement';
import { pensionContributionForYear, type PensionCashflow } from './retirement-pensions';

function fixture() {
  const plan = createExampleRetirementPlan(2026);
  plan.inflation = 0;
  plan.pensionLinks = [{ accountCode: 'PENSION', person: 0, share: 1, startYear: 2026 }];
  return plan;
}

function source(firstYear = 2026, lastMonth = 12): PensionCashflow {
  const months = Array.from({ length: lastMonth }, (_, index) => `${firstYear}-${String(index + 1).padStart(2, '0')}`);
  return { months, cashOut: [{ accountCode: 'PENSION', accountName: 'Example pension payments', monthly: months.map((_, index) => 100 + index), isProjected: months.map(() => false), hasOverride: months.map(() => false) }] };
}

describe('pensionContributionForYear', () => {
  it('does not inflate fixed-cash contributions beyond the source forecast', () => {
    const plan = fixture(); plan.inflation = 0.1;
    plan.people[0].assets.pension.contributionBasis = 'nominal';
    const data = source();
    expect(pensionContributionForYear(plan, 0, 2028, data)?.amount).toBe(12 * 111);
    plan.people[0].assets.pension.contributionGrowth = 0.02;
    expect(pensionContributionForYear(plan, 0, 2028, data)?.amount).toBeCloseTo(12 * 111 * 1.02 ** 2, 6);
  });

  it('keeps manual behaviour without applicable links or before their first calendar year', () => {
    const plan = fixture();
    expect(pensionContributionForYear(plan, 0, 2025)).toBeNull();
    expect(pensionContributionForYear(plan, 1, 2026)).toBeNull();
    delete plan.pensionLinks;
    expect(pensionContributionForYear(plan, 0, 2026)).toBeNull();
    plan.pensionLinks = [];
    expect(pensionContributionForYear(plan, 0, 2026)).toBeNull();
  });

  it('sums the exact monthly values once and reports projected source months', () => {
    const plan = fixture();
    plan.people[0].assets.pension.contributionGrowth = 0.1;
    const data = source(2027);
    data.cashOut[0].isProjected[4] = true;
    data.cashOut[0].hasOverride[4] = true;
    expect(pensionContributionForYear(plan, 0, 2027, data)).toEqual({ amount: 1266, estimated: true, extended: false });
    data.cashOut[0].isProjected.fill(false);
    expect(pensionContributionForYear(plan, 0, 2027, data)).toEqual({ amount: 1266, estimated: false, extended: false });
  });

  it('allocates shares to both people and activates each account only from its own start year', () => {
    const plan = fixture();
    plan.pensionLinks = [
      { accountCode: 'PENSION', person: 0, share: 0.25, startYear: 2026 },
      { accountCode: 'PENSION', person: 1, share: 0.75, startYear: 2026 },
      { accountCode: 'LATER', person: 0, share: 1, startYear: 2027 },
    ];
    const data = source();
    data.cashOut.push({ ...data.cashOut[0], accountCode: 'LATER', monthly: data.months.map(() => 200) });
    expect(pensionContributionForYear(plan, 0, 2026, data)?.amount).toBe(316.5);
    expect(pensionContributionForYear(plan, 1, 2026, data)?.amount).toBe(949.5);
    expect(pensionContributionForYear(plan, 0, 2027, data)?.amount).toBe(2733);
  });

  it('repeats the final monthly forecast for a partial last year and grows only later calendar years', () => {
    const plan = fixture();
    plan.people[0].assets.pension.contributionGrowth = 0.1;
    const data = source(2026, 6);
    expect(pensionContributionForYear(plan, 0, 2026, data)).toEqual({ amount: 615 + 6 * 105, estimated: true, extended: true });
    expect(pensionContributionForYear(plan, 0, 2027, data)?.amount).toBeCloseTo(12 * 105 * 1.1, 8);
    expect(pensionContributionForYear(plan, 0, 2028, data)?.amount).toBeCloseTo(12 * 105 * 1.1 ** 2, 8);
    plan.pensionLinks![0].share = 0.5;
    expect(pensionContributionForYear(plan, 0, 2028, data)?.amount).toBeCloseTo(6 * 105 * 1.1 ** 2, 8);
  });

  it('accepts a genuine zero source amount and ignores disabled partner links', () => {
    const plan = fixture();
    const data = source();
    data.cashOut[0].monthly.fill(0);
    expect(pensionContributionForYear(plan, 0, 2026, data)).toEqual({ amount: 0, estimated: false, extended: false });
    plan.partnerEnabled = false;
    plan.pensionLinks = [{ accountCode: 'MISSING', person: 1, share: 1, startYear: 2026 }];
    expect(pensionContributionForYear(plan, 1, 2026)).toBeNull();
  });

  it('requires source context once links apply', () => {
    expect(() => pensionContributionForYear(fixture(), 0, 2026)).toThrow(/cashflow.*(load|refresh)/i);
  });

  it('reports missing historical months instead of substituting zero or extending backwards', () => {
    const data = source();
    data.months[0] = '2025-12';
    expect(() => pensionContributionForYear(fixture(), 0, 2026, data)).toThrow(/2026-01.*missing/i);
    expect(() => pensionContributionForYear(fixture(), 0, 2026, source(2027))).toThrow(/2026-01.*missing/i);
  });

  it.each(['missing', 'excluded'] as const)('reports a %s account', mode => {
    const data = source();
    if (mode === 'missing') data.cashOut = [];
    else data.cashOut[0].excluded = true;
    expect(() => pensionContributionForYear(fixture(), 0, 2026, data)).toThrow(/PENSION.*(missing|hidden|excluded)/i);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, undefined])('requires finite nonnegative monthly amounts (%s)', amount => {
    const data = source();
    data.cashOut[0].monthly[0] = amount as number;
    expect(() => pensionContributionForYear(fixture(), 0, 2026, data)).toThrow(/PENSION.*2026-01.*(negative|invalid|missing|finite)/i);
  });

  it.each(['duplicate', 'unordered', 'invalid', 'empty'] as const)('rejects a %s source window', mode => {
    const data = source();
    if (mode === 'duplicate') data.months[1] = data.months[0];
    if (mode === 'unordered') data.months.reverse();
    if (mode === 'invalid') data.months[0] = '2026-13';
    if (mode === 'empty') data.months = [];
    expect(() => pensionContributionForYear(fixture(), 0, 2026, data)).toThrow(/cashflow.*(month|window)/i);
  });

  it('requires the monthly projected flag for accurate preview metadata', () => {
    const data = source();
    data.cashOut[0].isProjected = [];
    expect(() => pensionContributionForYear(fixture(), 0, 2026, data)).toThrow(/PENSION.*2026-01.*projection/i);
  });

  it.each(['monthly', 'isProjected'] as const)('reports a missing %s array with an actionable source error', key => {
    const data = source();
    data.cashOut[0][key] = undefined as never;
    expect(() => pensionContributionForYear(fixture(), 0, 2026, data)).toThrow(/PENSION.*2026-01.*(missing|projection)/i);
  });

  it('leaves source data and the plan unchanged', () => {
    const plan = fixture();
    const data = source();
    const before = structuredClone({ plan, data });
    pensionContributionForYear(plan, 0, 2028, data);
    expect({ plan, data }).toEqual(before);
  });
});
