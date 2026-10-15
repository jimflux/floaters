import { describe, expect, it } from 'vitest';
import { RETIREMENT_ASSETS, retirementPlanErrors, type RetirementPlan } from '@floaters/types';
import type { PensionCashflow } from './retirement-pensions';
import { createExampleRetirementPlan, incomeTax, projectRetirement } from './retirement';
import { projectionEndAge } from './retirement-assumptions';

function plan(): RetirementPlan {
  const value = createExampleRetirementPlan(2026);
  value.partnerEnabled = false;
  value.inflation = 0;
  delete value.longevityAge;
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

describe('retirement pension link validation', () => {
  const link = { accountCode: 'PENSION', person: 0 as const, share: 0.5, startYear: 2026 };

  it('accepts legacy plans, empty links and retained disabled partner links', () => {
    const value = plan();
    expect(retirementPlanErrors(value)).toEqual([]);
    value.pensionLinks = [];
    expect(retirementPlanErrors(value)).toEqual([]);
    value.pensionLinks = [link, { ...link, person: 1 }];
    expect(retirementPlanErrors(value)).toEqual([]);
  });

  it.each([
    null, {}, Array(21).fill(link), [null], [{ ...link, accountCode: '' }],
    [{ ...link, accountCode: ' '.repeat(3) }], [{ ...link, accountCode: 'a'.repeat(101) }],
    [{ ...link, person: 2 }], [{ ...link, share: 0 }], [{ ...link, share: -0.1 }],
    [{ ...link, share: 1.01 }], [{ ...link, share: Number.NaN }],
    [{ ...link, share: Number.POSITIVE_INFINITY }], [{ ...link, startYear: 1999 }],
    [{ ...link, startYear: 2221 }], [{ ...link, startYear: 2026.5 }],
    [link, link], [link, { ...link, person: 1, share: 0.6 }],
  ].map(pensionLinks => ({ pensionLinks })))('rejects malformed, excessive, duplicate or overallocated links (%j)', ({ pensionLinks }) => {
    expect(retirementPlanErrors({ ...plan(), pensionLinks }).length).toBeGreaterThan(0);
  });

  it('bounds the list at 20, accepts year bounds and tolerates only floating point allocation noise', () => {
    const value = plan();
    value.pensionLinks = Array.from({ length: 20 }, (_, index) => ({ ...link, accountCode: `P${index}`, share: 1, startYear: index % 2 ? 2000 : 2220 }));
    expect(retirementPlanErrors(value)).toEqual([]);
    value.pensionLinks = [link, { ...link, person: 1, share: 0.5000000005 }];
    expect(retirementPlanErrors(value)).toEqual([]);
    value.pensionLinks[1].share = 0.500000002;
    expect(retirementPlanErrors(value).length).toBeGreaterThan(0);
  });
});

describe('incomeTax', () => {
  it.each([[0, 0], [12570, 0], [50270, 7540], [100000, 27432], [110000, 33432], [125140, 42516], [150000, 53703]])('taxes £%s with the allowance, taper and bands', (gross, tax) => {
    expect(incomeTax(gross)).toBeCloseTo(tax, 6);
  });
});

describe('projectRetirement', () => {
  it('keeps child savings out of assets, returns and household drawdown in every case', () => {
    const value = createExampleRetirementPlan(2026);
    const before = structuredClone(value);
    value.childSavings = { name: 'Example child', balanceDate: '2026-10-15', jisa: 1200, universityFund: 500 };
    for (const scenario of ['cautious', 'base', 'optimistic'] as const) {
      expect(projectRetirement(value, scenario)).toEqual(projectRetirement(before, scenario));
    }
  });

  it('validates separately dated child savings while accepting plans without them', () => {
    const value = plan();
    const childSavings = { name: 'Example child', balanceDate: '2026-10-15', jisa: 1200, universityFund: 500 };
    expect(retirementPlanErrors({ ...value, childSavings })).toEqual([]);
    expect(retirementPlanErrors({ ...value, childSavings: { ...childSavings, balanceDate: '2027-01-01', jisa: 0, universityFund: 0 } })).toEqual([]);
    for (const invalid of [null, [], {}, { ...childSavings, name: '' }, { ...childSavings, jisa: -1 }, { ...childSavings, jisa: Number.NaN }, { ...childSavings, universityFund: Infinity }, { ...childSavings, balanceDate: '' }, { ...childSavings, balanceDate: '2026-02-30' }]) {
      expect(retirementPlanErrors({ ...value, childSavings: invalid }).length).toBeGreaterThan(0);
    }
  });

  it('projects forward from dated balances with only the remaining growth, savings, income and spending', () => {
    const value = plan();
    value.balanceDate = '2026-07-01';
    value.people[0].retirementAge = 62;
    value.endAge = 61;
    value.people[0].assets.isa = { balance: 10000, annualContribution: 3650, contributionGrowth: 0, returns: { cautious: 0, base: 0.1, optimistic: 0.2 } };
    income(value, 36500);
    spend(value, 36500);
    const before = structuredClone(value);
    const rows = projectRetirement(value, 'base').years;
    const remaining = 184 / 365;
    expect(rows[0].contributions).toBeCloseTo(3650 * remaining, 6);
    expect(rows[0].income).toBeCloseTo(36500 * remaining, 6);
    expect(rows[0].spending).toBeCloseTo(36500 * remaining, 6);
    expect(rows[0].tax).toBeCloseTo(incomeTax(36500) * remaining, 6);
    expect(rows[0].isa).toBeCloseTo(10000 * 1.1 ** remaining + 3650 * remaining - incomeTax(36500) * remaining, 6);
    expect(rows[1].contributions).toBe(3650);
    expect(value).toEqual(before);
  });

  it.each([
    { date: '2026-10-01', months: ['2026-10', '2026-11', '2026-12'], amounts: [100, 200, 300], expected: 600 },
    { date: '2026-10-15', months: ['2026-11', '2026-12'], amounts: [200, 300], expected: 500 },
    { date: '2026-12-01', months: ['2026-12'], amounts: [300], expected: 300 },
    { date: '2026-12-15', months: ['2026-12'], amounts: [300], expected: 0 },
  ])('uses only uncovered linked payment months after $date and resets the next year', ({ date, months, amounts, expected }) => {
    const value = plan();
    value.balanceDate = date;
    value.people[0].retirementAge = 62;
    value.endAge = 61;
    value.people[0].assets.pension.balance = 10000;
    value.people[0].assets.pension.annualContribution = 9999;
    value.pensionLinks = [{ accountCode: 'PENSION', person: 0, share: 1, startYear: 2026 }];
    const source: PensionCashflow = { months, cashOut: [{ accountCode: 'PENSION', accountName: 'Pension', monthly: amounts, isProjected: months.map(() => true), hasOverride: months.map(() => false) }] };
    const rows = projectRetirement(value, 'base', source).years;
    expect(rows[0]).toMatchObject({ pension: 10000 + expected, contributions: expected });
    expect(rows[1].contributions).toBe(3600);
    if (date === '2026-12-15') {
      expect(projectRetirement({ ...value, endAge: value.people[0].age }, 'base').years[0]).toMatchObject({ pension: 10000, contributions: 0 });
    }
  });

  it('accepts legacy January balances and validates the full balance date against the baseline year', () => {
    const value = plan();
    value.people[0].retirementAge = 61;
    value.people[0].assets.isa = { balance: 10000, annualContribution: 1000, contributionGrowth: 0, returns: { cautious: 0, base: 0.1, optimistic: 0.2 } };
    const legacy = structuredClone(value);
    expect(retirementPlanErrors(value)).toEqual([]);
    value.balanceDate = '2026-01-01';
    expect(projectRetirement(value, 'base')).toEqual(projectRetirement(legacy, 'base'));
    expect(projectRetirement(value, 'base').years[0].isa).toBe(12000);
    for (const date of ['', '2026-02-30', '2026-13-01', '2025-10-15', '2026-1-1']) {
      value.balanceDate = date;
      expect(retirementPlanErrors(value).some(error => /balance date/i.test(error))).toBe(true);
    }
    value.startYear = 2028;
    value.balanceDate = '2028-02-29';
    expect(retirementPlanErrors(value)).toEqual([]);
  });

  it('replaces manual regular pension contributions from the first linked year, preserves other assets and stops at retirement', () => {
    const value = plan();
    value.people[0].retirementAge = 63;
    value.endAge = 63;
    value.people[0].assets.pension.annualContribution = 1000;
    value.people[0].assets.pension.contributionGrowth = 0.1;
    value.people[0].assets.isa.annualContribution = 200;
    value.pensionLinks = [{ accountCode: 'PENSION', person: 0, share: 1, startYear: 2027 }];
    value.oneOffs = [{ id: 'gift', label: 'Separate deposit', year: 2027, person: 0, asset: 'pension', amount: 500 }];
    const source: PensionCashflow = { months: Array.from({ length: 24 }, (_, index) => `${2027 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}`), cashOut: [{ accountCode: 'PENSION', accountName: 'Pension', monthly: Array(24).fill(100), isProjected: Array(24).fill(true), hasOverride: Array(24).fill(false) }] };
    const before = structuredClone({ value, source });
    const rows = projectRetirement(value, 'base', source).years;
    expect(rows.map(row => row.contributions)).toEqual([1200, 1400, 1400, 0]);
    expect(rows.map(row => [row.contributionsByPerson[0].pension, row.contributionsByPerson[0].isa])).toEqual([[1000, 200], [1200, 200], [1200, 200], [0, 0]]);
    expect(rows.every(row => Object.values(row.contributionsByPerson[1]).every(amount => amount === 0))).toBe(true);
    expect(rows.map(row => row.pension)).toEqual([1000, 2700, 3900, 3900]);
    expect({ value, source }).toEqual(before);
  });

  it('does not require live data after retirement or for disabled partner links', () => {
    const value = plan();
    value.pensionLinks = [{ accountCode: 'PENSION', person: 0, share: 1, startYear: 2026 }, { accountCode: 'PARTNER', person: 1, share: 1, startYear: 2026 }];
    expect(projectRetirement(value, 'base').years[0].contributions).toBe(0);
    value.pensionLinks = [value.pensionLinks[1]];
    value.people[0].retirementAge = 61;
    value.people[0].assets.pension.annualContribution = 300;
    expect(projectRetirement(value, 'base').years[0].contributions).toBe(300);
  });

  it('reconciles each adult and pot to total contributions, including partial years and real growth', () => {
    const value = plan();
    value.partnerEnabled = true;
    value.balanceDate = '2026-07-01';
    value.endAge = 62;
    value.people[0].retirementAge = 62;
    value.people[1].retirementAge = 61;
    value.people[0].assets.pension.annualContribution = 6000;
    value.people[0].assets.isa.annualContribution = 2400;
    value.people[0].assets.isa.contributionGrowth = 0.1;
    value.people[1].assets.pension.annualContribution = 1200;
    value.people[1].assets.isa.annualContribution = 600;
    value.people[0].assets.cash.annualContribution = 300;
    const rows = projectRetirement(value, 'base').years;
    const fraction = (Date.UTC(2027, 0, 1) - Date.UTC(2026, 6, 1)) / (365 * 86400000);
    expect(rows[0].contributionsByPerson[0].pension).toBeCloseTo(6000 * fraction, 8);
    expect(rows[0].contributionsByPerson[1].isa).toBeCloseTo(600 * fraction, 8);
    expect(rows[1].contributionsByPerson[0].isa).toBeCloseTo(2640, 8);
    expect(rows[1].contributionsByPerson[1]).toEqual({ pension: 0, isa: 0, investments: 0, cash: 0 });
    expect(rows[2].contributions).toBe(0);
    for (const row of rows) expect(row.contributionsByPerson.flatMap(person => Object.values(person)).reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(row.contributions, 8);
  });

  it('requires live data for an active link and accepts zero linked contributions without using the manual amount', () => {
    const value = plan();
    value.people[0].retirementAge = 61;
    value.people[0].assets.pension.annualContribution = 1000;
    value.pensionLinks = [{ accountCode: 'PENSION', person: 0, share: 1, startYear: 2026 }];
    expect(() => projectRetirement(value, 'base')).toThrow(/cashflow/i);
    const source: PensionCashflow = { months: ['2026-01'], cashOut: [{ accountCode: 'PENSION', accountName: 'Pension', monthly: [0], isProjected: [true], hasOverride: [false] }] };
    expect(projectRetirement(value, 'base', source).years[0].contributions).toBe(0);
  });

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

  it('uses cash and investments, then tax-free pension income before ISA across the household', () => {
    const value = plan();
    value.partnerEnabled = true;
    value.people[0].assets.pension.balance = 10000;
    value.people[0].assets.isa.balance = 1000;
    value.people[1].assets.cash.balance = 1000;
    value.people[1].assets.investments.balance = 1000;
    spend(value, 2500);
    const row = projectRetirement(value, 'base').years[0];
    expect(row).toMatchObject({ cash: 0, investments: 0, isa: 1000, pension: 9500, withdrawals: 2500, shortfall: 0, partnerAge: 60 });
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
      expect(result.years).toHaveLength(projectionEndAge(value) - value.people[0].age + 1);
      expect(result.years[0].year).toBe(value.startYear);
      expect(result.years[result.years.length - 1].age).toBe(projectionEndAge(value));
      expect(result.years.every(row => RETIREMENT_ASSETS.every(key => row[key] >= 0))).toBe(true);
    }
    expect(value).toEqual(before);
  });
});
