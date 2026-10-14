import { describe, expect, it } from 'vitest';
import { RETIREMENT_ASSETS, retirementPlanErrors, type RetirementPlan } from '@floaters/types';
import { createExampleRetirementPlan, incomeTax, projectRetirement } from './retirement';

function plan(): RetirementPlan {
  const value = createExampleRetirementPlan(2026);
  value.partnerEnabled = false;
  value.people.forEach(person => {
    person.age = 60;
    person.retirementAge = 60;
    person.pensionAccessAge = 57;
    person.taxFreeAllowance = 268275;
    for (const key of RETIREMENT_ASSETS) {
      person.assets[key] = { balance: 0, annualContribution: 0, contributionGrowth: 0, returns: { cautious: 0, base: 0, optimistic: 0 } };
    }
  });
  value.endAge = 60;
  value.income = [];
  value.spending = [];
  value.oneOffs = [];
  return value;
}

function spend(value: RetirementPlan, amount: number) {
  value.spending.push({ id: 'living', label: 'Living costs', startAge: 18, endAge: 120, annualAmount: amount });
}

function income(value: RetirementPlan, amount: number, person: 0 | 1 = 0, taxable = true) {
  value.income.push({ id: `income-${person}`, label: 'Regular income', person, startAge: 18, endAge: 120, annualAmount: amount, taxable });
}

describe('incomeTax', () => {
  it.each([[0, 0], [12570, 0], [50270, 7540], [100000, 27432], [110000, 33432], [125140, 42516], [150000, 53703]])('taxes £%s with the allowance, taper and bands', (gross, tax) => {
    expect(incomeTax(gross)).toBeCloseTo(tax, 6);
  });
});

describe('projectRetirement', () => {
  it('builds a valid generic example for the requested year', () => {
    const example = createExampleRetirementPlan(2030);
    expect(example.startYear).toBe(2030);
    expect(retirementPlanErrors(example)).toEqual([]);
    expect(example.people[0].name).toMatch(/example/i);
  });

  it('compounds real returns and external contributions, stopping at retirement age', () => {
    const value = plan();
    value.people[0].retirementAge = 62;
    value.endAge = 62;
    value.people[0].assets.cash = { balance: 1000, annualContribution: 100, contributionGrowth: 0.1, returns: { cautious: -0.1, base: 0.1, optimistic: 0.2 } };
    const result = projectRetirement(value, 'base');
    [100, 110, 0].forEach((amount, index) => expect(result.years[index].contributions).toBeCloseTo(amount, 6));
    [1200, 1430, 1573].forEach((amount, index) => expect(result.years[index].totalAssets).toBeCloseTo(amount, 6));
    expect(result.assetsAtRetirement).toBeCloseTo(1573, 6);
    expect(projectRetirement(value, 'cautious').years[0].totalAssets).toBe(1000);
    expect(projectRetirement(value, 'optimistic').years[0].totalAssets).toBe(1300);
  });

  it('does not charge external contributions against annual spending', () => {
    const value = plan();
    value.people[0].retirementAge = 61;
    value.people[0].assets.pension.annualContribution = 1000;
    value.people[0].assets.cash.balance = 100;
    spend(value, 100);
    const row = projectRetirement(value, 'base').years[0];
    expect(row.pension).toBe(1000);
    expect(row.withdrawals).toBe(100);
    expect(row.shortfall).toBe(0);
  });

  it('uses accessible assets for the pension-age bridge and reports unmet spending', () => {
    const value = plan();
    value.people[0].age = 55;
    value.endAge = 57;
    value.people[0].assets.pension.balance = 100000;
    value.people[0].assets.cash.balance = 1000;
    spend(value, 2000);
    const result = projectRetirement(value, 'base');
    expect(result.years.map(row => row.shortfall)).toEqual([1000, 2000, 0]);
    expect(result.years[0].pension).toBe(100000);
    expect(result.years[0].accessibleAssets).toBe(0);
    expect(result.years[2].pension).toBe(98000);
    expect(result.firstShortfall).toEqual({ year: 2026, age: 55, amount: 1000 });
  });

  it('draws cash, investments, ISA, then pensions across the household', () => {
    const value = plan();
    value.partnerEnabled = true;
    value.people[0].assets.pension.balance = 10000;
    value.people[0].assets.isa.balance = 1000;
    value.people[1].assets.cash.balance = 1000;
    value.people[1].assets.investments.balance = 1000;
    spend(value, 2500);
    const row = projectRetirement(value, 'base').years[0];
    expect(row).toMatchObject({ cash: 0, investments: 0, isa: 500, pension: 10000, withdrawals: 2500, shortfall: 0, partnerAge: 60 });
  });

  it.each([0, 1] as const)('lets person %s fund pooled household spending from their pension', owner => {
    const value = plan();
    value.partnerEnabled = true;
    value.people[owner].assets.pension.balance = 10000;
    spend(value, 4000);
    expect(projectRetirement(value, 'base').years[0]).toMatchObject({ pension: 6000, shortfall: 0, withdrawals: 4000 });
  });

  it('grosses up pension cash using incremental tax without charging regular tax twice', () => {
    const value = plan();
    value.people[0].assets.pension.balance = 100000;
    income(value, 20000);
    const netIncome = 20000 - incomeTax(20000);
    spend(value, netIncome + 10000);
    const row = projectRetirement(value, 'base').years[0];
    expect(row.withdrawals).toBeCloseTo(10000 / 0.85, 6);
    expect(row.tax).toBeCloseTo(incomeTax(20000) + row.withdrawals * 0.75 * 0.2, 6);
    expect(row.income + row.withdrawals - row.tax).toBeCloseTo(row.spending, 6);
    expect(row.shortfall).toBe(0);
  });

  it('caps the tax-free portion and carries the used allowance into later years', () => {
    const value = plan();
    value.endAge = 61;
    value.people[0].assets.pension.balance = 100000;
    value.people[0].taxFreeAllowance = 1000;
    income(value, 12570);
    spend(value, 22570);
    const rows = projectRetirement(value, 'base').years;
    expect(rows[0].withdrawals).toBeCloseTo(12250, 6);
    expect(rows[0].tax).toBeCloseTo(2250, 6);
    expect(rows[1].withdrawals).toBeCloseTo(12500, 6);
    expect(rows[1].tax).toBeCloseTo(2500, 6);
  });

  it('solves withdrawals through the allowance taper and additional-rate band', () => {
    const value = plan();
    value.people[0].assets.pension.balance = 100000;
    value.people[0].taxFreeAllowance = 0;
    income(value, 100000);
    spend(value, 100000 - incomeTax(100000) + 20000);
    const row = projectRetirement(value, 'base').years[0];
    expect(row.withdrawals).toBeGreaterThan(25140);
    expect(row.tax).toBeCloseTo(incomeTax(100000 + row.withdrawals), 6);
    expect(row.income + row.withdrawals - row.tax).toBeCloseTo(row.spending, 6);
    expect(row.shortfall).toBe(0);
  });

  it('taxes each partner separately and bounds income against that person’s age', () => {
    const value = plan();
    value.partnerEnabled = true;
    value.people[1].age = 58;
    income(value, 20000, 0);
    income(value, 20000, 1);
    value.income[1].startAge = 58;
    value.income[1].endAge = 58;
    spend(value, 35000);
    const row = projectRetirement(value, 'base').years[0];
    expect(row.income).toBe(40000);
    expect(row.tax).toBe(incomeTax(20000) * 2);
    expect(row.partnerAge).toBe(58);
    expect(row.shortfall).toBe(0);
  });

  it('respects pension capacity after gross-up and never creates negative balances', () => {
    const value = plan();
    value.people[0].assets.pension.balance = 1000;
    value.people[0].taxFreeAllowance = 0;
    income(value, 12570);
    spend(value, 14570);
    const row = projectRetirement(value, 'base').years[0];
    expect(row).toMatchObject({ pension: 0, totalAssets: 0, withdrawals: 1000, tax: 200, shortfall: 1200 });
  });

  it('applies positive deposits only in their year and flags partial bucket withdrawals', () => {
    const value = plan();
    value.endAge = 61;
    value.people[0].assets.cash.balance = 100;
    value.oneOffs = [
      { id: 'out', label: 'Expense', year: 2026, person: 0, asset: 'cash', amount: -200 },
      { id: 'in', label: 'Gift', year: 2027, person: 0, asset: 'isa', amount: 500 },
    ];
    const rows = projectRetirement(value, 'base').years;
    expect(rows[0]).toMatchObject({ totalAssets: 0, shortfall: 100 });
    expect(rows[1]).toMatchObject({ totalAssets: 500, isa: 500, shortfall: 0 });
  });

  it('blocks pension one-offs before access age even when other cash is available', () => {
    const value = plan();
    value.people[0].age = 55;
    value.endAge = 55;
    value.people[0].assets.pension.balance = 10000;
    value.people[0].assets.cash.balance = 10000;
    value.oneOffs = [{ id: 'out', label: 'Pension expense', year: 2026, person: 0, asset: 'pension', amount: -1000 }];
    expect(projectRetirement(value, 'base').years[0]).toMatchObject({ pension: 10000, cash: 10000, shortfall: 1000 });
  });

  it('charges pension one-off tax once, consumes allowance, and never redeposits proceeds', () => {
    const value = plan();
    value.people[0].assets.pension.balance = 10000;
    value.people[0].assets.cash.balance = 1000;
    value.people[0].taxFreeAllowance = 250;
    income(value, 12570);
    spend(value, 12570);
    value.oneOffs = [{ id: 'out', label: 'Pension expense', year: 2026, person: 0, asset: 'pension', amount: -1000 }];
    expect(projectRetirement(value, 'base').years[0]).toMatchObject({ pension: 9000, cash: 850, tax: 150, withdrawals: 150, shortfall: 0 });
  });

  it('combines same-year one-off and normal pension taxable withdrawals for gross-up', () => {
    const value = plan();
    value.people[0].assets.pension.balance = 100000;
    value.people[0].taxFreeAllowance = 0;
    income(value, 50270);
    spend(value, 50270 - incomeTax(50270) + 6000);
    value.oneOffs = [{ id: 'out', label: 'Pension expense', year: 2026, person: 0, asset: 'pension', amount: -1000 }];
    const row = projectRetirement(value, 'base').years[0];
    expect(row.withdrawals).toBeCloseTo(6400 / 0.6, 6);
    expect(row.pension).toBeCloseTo(100000 - 1000 - row.withdrawals, 6);
    expect(row.tax).toBeCloseTo(7540 + 400 + row.withdrawals * 0.4, 6);
    expect(row.shortfall).toBe(0);
  });

  it('flags missing one-off gross amounts separately from their actual withdrawal tax', () => {
    const value = plan();
    value.people[0].assets.pension.balance = 1000;
    value.people[0].assets.cash.balance = 500;
    value.people[0].taxFreeAllowance = 0;
    income(value, 12570);
    spend(value, 12570);
    value.oneOffs = [{ id: 'out', label: 'Pension expense', year: 2026, person: 0, asset: 'pension', amount: -2000 }];
    expect(projectRetirement(value, 'base').years[0]).toMatchObject({ pension: 0, cash: 300, tax: 200, shortfall: 1000 });
  });

  it('uses inclusive age-bounded income/spending and saves surplus net income in cash', () => {
    const value = plan();
    value.endAge = 62;
    value.income = [{ id: 'income', label: 'Tax-free income', person: 0, startAge: 61, endAge: 61, annualAmount: 300, taxable: false }];
    value.spending = [{ id: 'cost', label: 'Cost', startAge: 61, endAge: 61, annualAmount: 100 }];
    const rows = projectRetirement(value, 'base').years;
    expect(rows.map(row => row.income)).toEqual([0, 300, 0]);
    expect(rows.map(row => row.spending)).toEqual([0, 100, 0]);
    expect(rows.map(row => row.cash)).toEqual([0, 200, 200]);
  });

  it('ignores disabled partner balances, contributions, incomes, and one-offs', () => {
    const value = plan();
    value.people[1].retirementAge = 65;
    value.people[1].assets.cash.balance = 10000;
    value.people[1].assets.cash.annualContribution = 10000;
    income(value, 10000, 1);
    value.oneOffs = [{ id: 'gift', label: 'Gift', year: 2026, person: 1, asset: 'cash', amount: 10000 }];
    spend(value, 100);
    expect(projectRetirement(value, 'base').years[0]).toMatchObject({ totalAssets: 0, partnerAge: null, contributions: 0, income: 0, shortfall: 100 });
  });

  it('keeps input unchanged across scenario runs and includes every year through endAge', () => {
    const value = createExampleRetirementPlan(2026);
    const before = structuredClone(value);
    for (const scenario of ['base', 'cautious', 'optimistic'] as const) {
      const result = projectRetirement(value, scenario);
      expect(result.years).toHaveLength(value.endAge - value.people[0].age + 1);
      expect(result.years[0].year).toBe(value.startYear);
      expect(result.years[result.years.length - 1].age).toBe(value.endAge);
      expect(result.years.every(row => RETIREMENT_ASSETS.every(key => row[key] >= 0))).toBe(true);
    }
    expect(value).toEqual(before);
  });
});
