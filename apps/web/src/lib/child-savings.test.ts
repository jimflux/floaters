import { describe, expect, it } from 'vitest';
import { retirementPlanErrors, type RetirementChildSavings } from '@floaters/types';
import { createExampleRetirementPlan, projectRetirement } from './retirement';
import { projectChildSavings } from './child-savings';

const fixture = (): RetirementChildSavings => ({ name: 'Example child', balanceDate: '2026-10-15', jisa: 1000, universityFund: 500,
  ageAtBalanceDate: 6, monthlyUniContribution: 120, jisaAnnualReturn: 0.05, universityAnnualReturn: 0.04 });

describe('child savings projection', () => {
  it('compounds both funds monthly to 18 with uni payments at month end and no JISA top-ups', () => {
    const savings = fixture();
    const rows = projectChildSavings(savings)!;
    expect(rows).toHaveLength(13);
    expect(rows[0]).toMatchObject({ age: 6, year: 2026, jisa: 1000, universityFund: 500, total: 1500, addedContributions: 0 });
    const last = rows[rows.length - 1];
    const monthly = 1.04 ** (1 / 12) - 1;
    expect(last).toMatchObject({ age: 18, year: 2038, addedContributions: 120 * 144 });
    expect(last.jisa).toBeCloseTo(1000 * 1.05 ** 12, 6);
    expect(last.universityFund).toBeCloseTo(500 * 1.04 ** 12 + 120 * (1.04 ** 12 - 1) / monthly, 6);
    expect(last.total).toBeCloseTo(last.jisa + last.universityFund, 6);
  });

  it('adds exactly the remaining monthly payments at zero growth', () => {
    const rows = projectChildSavings({ ...fixture(), ageAtBalanceDate: 17, jisaAnnualReturn: 0, universityAnnualReturn: 0 })!;
    expect(rows[1]).toMatchObject({ age: 18, jisa: 1000, universityFund: 1940, total: 2940, addedContributions: 1440 });
  });

  it('handles negative growth and stops contributions immediately at age 18', () => {
    const savings = { ...fixture(), ageAtBalanceDate: 17, jisaAnnualReturn: -0.5, universityAnnualReturn: -0.2, monthlyUniContribution: 0 };
    const rows = projectChildSavings(savings)!;
    expect(rows[1].jisa).toBeCloseTo(500, 8);
    expect(rows[1].universityFund).toBeCloseTo(400, 8);
    expect(projectChildSavings({ ...fixture(), ageAtBalanceDate: 18 })).toEqual([expect.objectContaining({ total: 1500, addedContributions: 0 })]);
  });

  it('preserves existing plans without child ages and requires age before projecting', () => {
    const savings = fixture();
    delete savings.ageAtBalanceDate;
    expect(projectChildSavings(savings)).toBeNull();
    const plan = createExampleRetirementPlan();
    plan.childSavings = savings;
    expect(retirementPlanErrors(plan)).toEqual([]);
  });

  it.each([
    { ageAtBalanceDate: -1 }, { ageAtBalanceDate: 19 }, { ageAtBalanceDate: 6.5 },
    { monthlyUniContribution: -1 }, { monthlyUniContribution: NaN },
    { jisaAnnualReturn: -0.6 }, { universityAnnualReturn: 0.6 }, { balanceDate: '2026-02-31' },
  ])('rejects invalid assumptions without drawing a misleading chart (%j)', change => {
    const savings = { ...fixture(), ...change };
    expect(projectChildSavings(savings)).toBeNull();
    const plan = createExampleRetirementPlan();
    plan.childSavings = savings;
    expect(retirementPlanErrors(plan).length).toBeGreaterThan(0);
  });

  it('keeps child projections and contributions separate from household retirement balances', () => {
    const plan = createExampleRetirementPlan();
    const before = projectRetirement(plan, 'base');
    plan.childSavings = fixture();
    const original = structuredClone(plan);
    projectChildSavings(plan.childSavings);
    expect(projectRetirement(plan, 'base')).toEqual(before);
    expect(plan).toEqual(original);
  });
});
