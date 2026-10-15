import { describe, expect, it } from 'vitest';
import { RETIREMENT_ASSETS, retirementPlanErrors, type RetirementPlan } from '@floaters/types';
import { createExampleRetirementPlan, projectRetirement } from './retirement';
import { analyseFire, firePlanAtAge, isWorkIncome } from './retirement-fire';

function fixture(): RetirementPlan {
  const plan = createExampleRetirementPlan(2026);
  plan.partnerEnabled = false;
  plan.inflation = 0;
  delete plan.longevityAge;
  plan.endAge = 80;
  plan.people.forEach(person => {
    person.age = 40; person.retirementAge = 60; person.pensionAccessAge = 57;
    for (const key of RETIREMENT_ASSETS) person.assets[key] = { balance: 0, annualContribution: 0, contributionGrowth: 0, returns: { cautious: 0, base: 0, optimistic: 0 } };
  });
  plan.income = []; plan.oneOffs = [];
  plan.spending = [{ id: 'living', label: 'Living costs', startAge: 60, endAge: 80, annualAmount: 20000 }];
  return plan;
}

describe('FIRE plan transformation', () => {
  it('starts living costs at FIRE without doubling existing earlier costs or moving later phases', () => {
    const plan = fixture();
    plan.spending.push({ id: 'earlier', label: 'Existing costs', startAge: 50, endAge: 59, annualAmount: 12000 });
    plan.spending[0].endAge = 70;
    plan.spending.push({ id: 'later', label: 'Later costs', startAge: 71, endAge: 80, annualAmount: 30000 });
    const before = structuredClone(plan);
    const draft = firePlanAtAge(plan, 48, { keepWork: false });
    const costs = (age: number) => draft.spending.reduce((sum, r) => sum + (r.startAge <= age && r.endAge >= age ? r.annualAmount : 0), 0);
    expect(costs(47)).toBe(0);
    for (let age = 48; age <= 70; age++) expect(costs(age)).toBe(20000);
    expect(costs(71)).toBe(30000);
    expect(retirementPlanErrors(draft)).toEqual([]);
    expect(plan).toEqual(before);
  });

  it('keeps the retirement job from the FIRE age through its original end age, with fixed benefits and dates intact', () => {
    const plan = fixture();
    plan.income = [
      { id: 'work', label: 'Part Time Work', person: 0, startAge: 60, endAge: 68, annualAmount: 10000, taxable: true },
      { id: 'state', label: 'State Pension', person: 0, kind: 'state-pension', startAge: 68, endAge: 120, annualAmount: 12000, taxable: true },
      { id: 'other-work', label: 'Partner work', person: 1, kind: 'employment', startAge: 60, endAge: 68, annualAmount: 5000, taxable: true },
    ];
    plan.oneOffs = [{ id: 'gift', label: 'Dated gift', person: 0, asset: 'isa', year: 2040, amount: 10000 }];
    const draft = firePlanAtAge(plan, 50, { keepWork: true });
    expect(draft.income[0]).toMatchObject({ startAge: 50, endAge: 68, kind: 'employment', annualAmount: 10000 });
    expect(draft.income.slice(1)).toEqual(plan.income.slice(1));
    expect(draft.oneOffs).toEqual(plan.oneOffs);
    expect(draft.people[1]).toEqual(plan.people[1]);
    expect(draft.people[0].pensionAccessAge).toBe(57);
    expect(firePlanAtAge(plan, 70, { keepWork: true }).income[0].annualAmount).toBe(0);
  });

  it('stops paid work at FIRE while preserving non-work income and valid row dates', () => {
    const plan = fixture();
    plan.income = [
      { id: 'job', label: 'Salary', person: 0, kind: 'employment', startAge: 40, endAge: 65, annualAmount: 10000, taxable: true },
      { id: 'future', label: 'Part Time Work', person: 0, startAge: 60, endAge: 68, annualAmount: 5000, taxable: true },
      { id: 'rent', label: 'Rent', person: 0, kind: 'other', startAge: 50, endAge: 80, annualAmount: 1000, taxable: true },
    ];
    const draft = firePlanAtAge(plan, 50, { keepWork: false });
    expect(draft.income[0].endAge).toBe(49);
    expect(draft.income[1]).toMatchObject({ startAge: 60, endAge: 68, annualAmount: 0 });
    expect(draft.income[2]).toEqual(plan.income[2]);
    expect(retirementPlanErrors(draft)).toEqual([]);
    expect(isWorkIncome({ ...plan.income[0], kind: undefined, label: 'Work pension' })).toBe(false);
    expect(isWorkIncome({ ...plan.income[0], kind: 'other', label: 'Work' })).toBe(false);
  });
});

describe('FIRE age search', () => {
  it('finds the earliest whole age using the full spending horizon and stops savings at retirement', () => {
    const plan = fixture();
    plan.endAge = 44;
    plan.people[0].retirementAge = 44;
    plan.people[0].assets.cash.annualContribution = 100;
    plan.spending = [{ id: 'cost', label: 'Costs', startAge: 44, endAge: 44, annualAmount: 50 }];
    const result = analyseFire(plan, undefined, 40, { keepWork: false });
    // Retire at 41: 100 saved, four years x 50 required. At 42: 200 saved,
    // three years x 50 required. A later income date cannot fund earlier costs.
    expect(result.earliestBase).toBe(42);
    expect(result.earliestCautious).toBe(42);
    const draft = firePlanAtAge(plan, 42, { keepWork: false });
    const projection = projectRetirement(draft, 'base');
    expect(projection.years.map(row => row.contributions)).toEqual([100, 100, 0, 0, 0]);
    expect(projection.years[4].totalAssets).toBe(50);
    expect(projection.firstShortfall).toBeNull();
  });

  it('cannot retire on locked pension assets when the ISA bridge is empty', () => {
    const plan = fixture();
    plan.people[0].assets.pension.balance = 1000000;
    const result = analyseFire(plan, undefined, 40, { keepWork: false });
    expect(result.earliestBase).toBe(57);
    expect(result.earliestCautious).toBe(57);
    expect(result.earliestCrash).toBe(57);
    expect(result.candidates.find(row => row.age === 56)?.baseShortfallAge).toBe(56);
  });

  it('keeps future one-offs dated instead of making them available at retirement', () => {
    const plan = fixture();
    plan.endAge = 42; plan.people[0].retirementAge = 42;
    plan.spending = [{ id: 'cost', label: 'Costs', startAge: 42, endAge: 42, annualAmount: 1000 }];
    plan.oneOffs = [{ id: 'gift', label: 'Future gift', person: 0, asset: 'cash', year: 2027, amount: 2000 }];
    const before = structuredClone(plan);
    const result = analyseFire(plan, undefined, 40, { keepWork: true });
    expect(result.earliestBase).toBe(41);
    expect(result.candidates[0].baseShortfallAge).toBe(40);
    expect(plan).toEqual(before);
  });

  it('reports no passing age when even the last tested year cannot be funded', () => {
    expect(analyseFire(fixture(), undefined, 40, { keepWork: false }).earliestBase).toBeNull();
  });

  it('uses the linked pension payments instead of manual savings and stops them at the trial age', () => {
    const plan = fixture();
    plan.endAge = 44; plan.people[0].retirementAge = 44;
    plan.people[0].pensionAccessAge = 42;
    plan.people[0].assets.pension.annualContribution = 10000;
    plan.spending = [{ id: 'cost', label: 'Costs', startAge: 44, endAge: 44, annualAmount: 1000 }];
    plan.pensionLinks = [{ accountCode: '700', person: 0, share: 1, startYear: 2026 }];
    const source = { months: Array.from({ length: 36 }, (_, i) => `${2026 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`),
      cashOut: [{ accountCode: '700', accountName: 'Pension', monthly: Array(36).fill(160), isProjected: Array(36).fill(true), hasOverride: Array(36).fill(false) }] };
    const result = analyseFire(plan, source, 40, { keepWork: true });
    expect(result.earliestBase).toBe(42);
    const projection = projectRetirement(firePlanAtAge(plan, 42, { keepWork: true }), 'base', source);
    expect(projection.years.map(row => row.contributions)).toEqual([1920, 1920, 0, 0, 0]);
    expect(projection.years[4].totalAssets).toBeCloseTo(840);
    expect(() => analyseFire(plan, undefined, 40, { keepWork: true })).toThrow(/need Floaters cashflow/);
  });

  it('finds a later passing age when a retirement crash breaks the accessible bridge', () => {
    const plan = fixture();
    plan.endAge = 44; plan.people[0].retirementAge = 44;
    plan.people[0].assets.isa.balance = 1000;
    plan.people[0].assets.isa.annualContribution = 500;
    plan.spending = [{ id: 'cost', label: 'Costs', startAge: 44, endAge: 44, annualAmount: 1000 }];
    const result = analyseFire(plan, undefined, 40, { keepWork: false });
    expect(result.earliestBase).toBe(43);
    expect(result.earliestCrash).toBe(44);
    expect(result.candidates.find(row => row.age === 43)?.crashShortfallAge).toBe(44);
  });

  it('requires a budget for every retirement year and a current whole-age search range', () => {
    const plan = fixture();
    expect(() => analyseFire(plan, undefined, 39, { keepWork: true })).toThrow(/balance date/);
    expect(() => analyseFire(plan, undefined, 40.5, { keepWork: true })).toThrow(/balance date/);
    plan.spending[0].endAge = 79;
    expect(() => analyseFire(plan, undefined, 40, { keepWork: true })).toThrow(/age 80/);
    plan.spending = [];
    expect(() => analyseFire(plan, undefined, 40, { keepWork: true })).toThrow(/spending budget/);
  });
});
