import { describe, expect, it } from 'vitest';
import { RETIREMENT_ASSETS, retirementPlanErrors, type RetirementPlan } from '@floaters/types';
import { createExampleRetirementPlan, projectRetirement } from './retirement';
import { assetFee, assetReturn, grossTaxBoundary, incomeTax, projectionEndAge, realReturn, retirementInputNotes, taxBands } from './retirement-assumptions';

function fixture(): RetirementPlan {
  const plan = createExampleRetirementPlan(2026);
  plan.inflation = 0;
  delete plan.longevityAge;
  plan.people.forEach(person => {
    person.age = 60; person.retirementAge = 60;
    for (const key of RETIREMENT_ASSETS) person.assets[key] = { balance: 0, annualContribution: 0, contributionGrowth: 0, returns: { cautious: 0, base: 0, optimistic: 0 } };
  });
  plan.partnerEnabled = false; plan.endAge = 60;
  plan.income = []; plan.spending = []; plan.oneOffs = [];
  return plan;
}
function spend(plan: RetirementPlan, amount: number, startAge = 60) {
  plan.spending = [{ id: 'living', label: 'Living', startAge, endAge: 120, annualAmount: amount }];
}

describe('retirement assumptions', () => {
  it('weights management tiers by nominal pot value and adds fund costs and spread once', () => {
    const asset = fixture().people[0].assets.pension;
    // Synthetic fee schedule; personal provider figures never live in fixtures.
    asset.feeSchedule = { threshold: 100000, below: 0.006, above: 0.002, fundCost: 0.001, marketSpread: 0.0005 };
    asset.grossReturns = { cautious: 0, base: 0.05, optimistic: 0.1 };
    asset.annualFee = 0.09; // unused flat legacy rate must not be added again
    asset.balance = 100000; expect(assetFee(asset)).toBeCloseTo(0.0075, 12);
    asset.balance = 200000; expect(assetFee(asset)).toBeCloseTo(0.0055, 12);
    asset.balance = 100000; expect(assetFee(asset, 2)).toBeCloseTo(0.0055, 12);
    expect(assetReturn(asset, 'base', 0.025, 2)).toBeCloseTo(1.05 * (1 - 0.0055) / 1.025 - 1, 12);
  });

  it('finds exact marginal-tax boundaries when indexed bands meet the frozen taper', () => {
    const bands = taxBands(2065, 0.025);
    expect(bands.allowance + bands.basic).toBeGreaterThan(bands.taper);
    const boundary = grossTaxBoundary(bands.basic, bands);
    const allowance = Math.max(0, bands.allowance - (boundary - bands.taper) / 2);
    expect(boundary - allowance).toBeCloseTo(bands.basic, 6);
    expect(incomeTax(boundary + 1, 2065, 0.025) - incomeTax(boundary, 2065, 0.025)).toBeCloseTo(0.6, 6);
    expect(incomeTax(boundary, 2065, 0.025) - incomeTax(boundary - 1, 2065, 0.025)).toBeCloseTo(0.3, 6);
  });

  it('compounds nominal returns, fees and inflation without reducing legacy net returns twice', () => {
    expect(realReturn(0.0694, 0.005, 0.025)).toBeCloseTo(0.03810048780487807, 12);
    const asset = fixture().people[0].assets.pension;
    asset.returns.base = 0.04;
    expect(assetReturn(asset, 'base', 0.025)).toBe(0.04);
    asset.grossReturns = { base: 0.0694, cautious: 0, optimistic: 0.1 }; asset.annualFee = 0.005;
    expect(assetReturn(asset, 'base', 0.025)).toBeCloseTo(0.03810048780487807, 12);
  });

  it('freezes nominal tax bands through 2030 and indexes only allowance/basic from 2031', () => {
    expect(taxBands(2030, 0.025)).toEqual(taxBands(2026, 0.025));
    expect(taxBands(2031, 0.025)).toEqual({ allowance: 12570 * 1.025, basic: 37700 * 1.025, taper: 100000, additional: 125140 });
    expect(incomeTax(150000, 2031, 0)).toBeCloseTo(53703, 6);
    expect(incomeTax(20000, 2031, 0.025)).toBeCloseTo((20000 - 12570 * 1.025) * 0.2, 6);
  });

  it('applies fiscal drag to real income, returning tax in balance-date pounds', () => {
    const plan = fixture(); plan.inflation = 0.025; plan.endAge = 61;
    plan.income = [{ id: 'income', label: 'Pension', person: 0, annualAmount: 12570, taxable: true, startAge: 60, endAge: 120 }];
    const rows = projectRetirement(plan, 'base').years;
    expect(rows[0].tax).toBe(0);
    expect(rows[1].tax).toBeCloseTo((12570 * 1.025 - 12570) * 0.2 / 1.025, 6);
  });

  it('carries the remaining lump-sum allowance in nominal pounds across years', () => {
    const plan = fixture(); plan.inflation = 0.1; plan.endAge = 61;
    plan.people[0].assets.pension.balance = 100000; plan.people[0].taxFreeAllowance = 1000;
    plan.income = [{ id: 'income', label: 'Income', person: 0, annualAmount: 20000, taxable: true, startAge: 60, endAge: 120 }];
    plan.oneOffs = [{ id: 'out', label: 'Out', person: 0, asset: 'pension', year: 2027, amount: -10000 }];
    const row = projectRetirement(plan, 'base').years[1];
    expect(row.tax).toBeCloseTo(incomeTax(22000) / 1.1 + (10000 - 1000 / 1.1) * 0.2, 6);
    expect(plan.people[0].taxFreeAllowance).toBe(1000);
  });

  it('uses both people’s allowances instead of draining one pension first', () => {
    const plan = fixture(); plan.partnerEnabled = true;
    plan.people.forEach(person => { person.assets.pension.balance = 200000; }); spend(plan, 40000);
    const row = projectRetirement(plan, 'base').years[0];
    const gross = 2 * (20000 - 12570 * 0.2) / 0.85;
    expect(row.withdrawals).toBeCloseTo(gross, 6);
    expect(row.tax).toBeCloseTo(gross - 40000, 6);
    expect(row.shortfall).toBe(0);
  });

  it('uses an unused income-tax allowance before depleting an ISA', () => {
    const plan = fixture(); plan.people[0].assets.pension.balance = 100000; plan.people[0].assets.isa.balance = 50000;
    spend(plan, 16760);
    const row = projectRetirement(plan, 'base').years[0];
    expect(row.tax).toBeCloseTo(0, 6);
    expect(row.pension).toBeCloseTo(83240, 6); expect(row.isa).toBe(50000);
  });

  it('conserves cash through taper bands, allowance exhaustion and uneven partner income', () => {
    for (const annual of [1, 15000, 40000, 120000, 300000]) for (const regular of [0, 12570, 100000]) for (const allowance of [0, 100, 268275]) {
      const plan = fixture(); plan.partnerEnabled = true;
      plan.people.forEach(person => { person.assets.pension.balance = 1000000; person.taxFreeAllowance = allowance; });
      plan.income = [{ id: 'income', label: 'Income', person: 0, annualAmount: regular, taxable: true, startAge: 60, endAge: 120 }];
      spend(plan, annual);
      const row = projectRetirement(plan, 'base').years[0];
      expect(row.shortfall).toBe(0);
      expect(row.income + row.withdrawals - row.tax - row.cash).toBeCloseTo(row.spending, 5);
      expect(row.pension).toBeGreaterThanOrEqual(0);
    }
  });

  it('covers the youngest enabled adult and includes late care spending', () => {
    const plan = fixture(); plan.people[0].age = 41; plan.people[1].age = 35;
    plan.endAge = 95; plan.longevityAge = 100; plan.partnerEnabled = true;
    expect(projectionEndAge(plan)).toBe(106);
    plan.spending = [{ id: 'care', label: 'Care', startAge: 91, endAge: 106, annualAmount: 60000 }];
    const rows = projectRetirement(plan, 'base').years;
    expect(rows.at(-1)).toMatchObject({ age: 106, partnerAge: 100, spending: 60000, shortfall: 60000 });
    expect(rows.filter(row => row.age >= 96 && row.age <= 100).reduce((sum, row) => sum + row.spending, 0)).toBe(300000);
    plan.partnerEnabled = false; expect(projectionEndAge(plan)).toBe(100);
  });

  it('shocks only invested opening assets once at retirement, leaving cash and new contributions intact', () => {
    const plan = fixture(); plan.people[0].retirementAge = 61; plan.endAge = 62;
    plan.people[0].assets.pension.balance = 10000; plan.people[0].assets.cash.balance = 10000;
    const before = structuredClone(plan);
    const rows = projectRetirement(plan, 'base', undefined, 'market-drop').years;
    expect(rows.map(row => row.pension)).toEqual([10000, 7000, 7000]);
    expect(rows.map(row => row.cash)).toEqual([10000, 10000, 10000]);
    expect(plan).toEqual(before);
  });

  it('limits weak returns to ten retirement years', () => {
    const plan = fixture(); plan.endAge = 70; plan.people[0].assets.isa.balance = 10000;
    const rows = projectRetirement(plan, 'base', undefined, 'weak-returns').years;
    expect(rows[9].isa).toBeCloseTo(10000 * 0.98 ** 10, 6);
    expect(rows[10].isa).toBeCloseTo(rows[9].isa, 6);
  });

  it.each(['lose-you', 'lose-partner'] as const)('models %s with one income, reduced spending and fully taxable inherited pension', stress => {
    const plan = fixture(); plan.partnerEnabled = true;
    const dead = stress === 'lose-you' ? 0 : 1;
    plan.people[dead].age = 85; plan.people[dead === 0 ? 1 : 0].age = 60;
    plan.endAge = plan.people[0].age;
    plan.people[dead].assets.pension.balance = 100000;
    plan.income = [{ id: 'lost', label: 'Lost income', person: dead, annualAmount: 30000, taxable: true, startAge: 60, endAge: 120 }];
    spend(plan, 20000, 18);
    const before = structuredClone(plan);
    const row = projectRetirement(plan, 'base', undefined, stress).years[0];
    expect(row.income).toBe(0); expect(row.spending).toBe(14000);
    const gross = (14000 - 12570 * 0.2) / 0.8;
    expect(row.withdrawals).toBeCloseTo(gross, 6); expect(row.tax).toBeCloseTo(gross - 14000, 6);
    expect(row.pension).toBeCloseTo(100000 - gross, 6); expect(plan).toEqual(before);
  });

  it('delays only State Pension rows by two years in that stress case', () => {
    const plan = fixture(); plan.endAge = 62;
    plan.income = [{ id: 'state', label: 'State Pension', person: 0, annualAmount: 10000, taxable: true, startAge: 60, endAge: 120, kind: 'state-pension', confirmed: false }];
    expect(projectRetirement(plan, 'base', undefined, 'later-state-pension').years.map(row => row.income)).toEqual([0, 0, 10000]);
    expect(retirementInputNotes(plan).join(' ')).toMatch(/entitlement/);
  });

  it('converts known future linked payments to real pounds once and extends them with inflation', () => {
    const plan = fixture(); plan.inflation = 0.025; plan.endAge = 62; plan.people[0].retirementAge = 63;
    plan.pensionLinks = [{ accountCode: 'PENSION', person: 0, share: 1, startYear: 2026 }];
    const months = Array.from({ length: 24 }, (_, i) => `${2026 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`);
    const source = { months, cashOut: [{ accountCode: 'PENSION', accountName: 'Pension', monthly: Array(24).fill(100), isProjected: Array(24).fill(true), hasOverride: Array(24).fill(false) }] };
    const rows = projectRetirement(plan, 'base', source).years;
    expect(rows[0].contributions).toBe(1200);
    expect(rows[1].contributions).toBeCloseTo(1200 / 1.025, 6);
    expect(rows[2].contributions).toBeCloseTo(1200 / 1.025, 6);
  });

  it('validates optional inputs without rejecting old saved plans', () => {
    const plan = fixture(); expect(retirementPlanErrors(plan)).toEqual([]);
    for (const inflation of [-1, 0.21, NaN, '0.025']) expect(retirementPlanErrors({ ...plan, inflation }).length).toBeGreaterThan(0);
    for (const longevityAge of [39, 111, 100.5, NaN]) expect(retirementPlanErrors({ ...plan, longevityAge }).length).toBeGreaterThan(0);
    plan.people[0].assets.pension.grossReturns = { cautious: 0, base: 0.04, optimistic: 0.06 };
    expect(retirementPlanErrors(plan).join(' ')).toMatch(/annual fee/);
    plan.people[0].assets.pension.annualFee = 0.005; expect(retirementPlanErrors(plan)).toEqual([]);
    plan.people[0].assets.pension.feesConfirmed = 'yes' as never; expect(retirementPlanErrors(plan).join(' ')).toMatch(/confirmation/);
    plan.people[0].assets.pension.feesConfirmed = true;
    for (const feeSchedule of [null, {}, { threshold: 0, below: 0, above: 0, fundCost: 0, marketSpread: 0 }, { threshold: 100000, below: NaN, above: 0, fundCost: 0, marketSpread: 0 }]) {
      plan.people[0].assets.pension.feeSchedule = feeSchedule as never;
      expect(retirementPlanErrors(plan).length).toBeGreaterThan(0);
    }
  });
});
