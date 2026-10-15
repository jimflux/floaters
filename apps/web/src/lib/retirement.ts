import {
  RETIREMENT_ASSETS,
  retirementPlanErrors,
  type RetirementAsset,
  type RetirementCase,
  type RetirementPerson,
  type RetirementPlan,
  type RetirementProjection,
} from '@floaters/types';
import { pensionContributionForYear, type PensionCashflow } from './retirement-pensions';

// England/Wales/NI 2026/27 rates, held constant in today's pounds for all years.
// https://www.gov.uk/income-tax-rates
export function incomeTax(income: number): number {
  const gross = Math.max(0, income);
  const allowance = Math.max(0, 12570 - Math.max(0, gross - 100000) / 2);
  const taxable = Math.max(0, gross - allowance);
  return Math.min(taxable, 37700) * 0.2
    + Math.min(Math.max(0, taxable - 37700), 125140 - 37700) * 0.4
    + Math.max(0, taxable - 125140) * 0.45;
}

/** Invented demonstration values; never populated from a personal workbook. */
export function createExampleRetirementPlan(year = 2026): RetirementPlan {
  const asset = (balance: number, annualContribution = 0, cash = false): RetirementAsset => ({
    balance,
    annualContribution,
    contributionGrowth: 0,
    returns: cash ? { cautious: -0.01, base: 0, optimistic: 0.01 } : { cautious: 0.01, base: 0.03, optimistic: 0.05 },
  });
  return {
    version: 1,
    startYear: year,
    endAge: 95,
    partnerEnabled: true,
    people: [
      {
        name: 'Example person', age: 45, retirementAge: 62, pensionAccessAge: 57, taxFreeAllowance: 268275,
        assets: { pension: asset(150000, 6000), isa: asset(30000, 2000), investments: asset(15000), cash: asset(12000, 0, true) },
      },
      {
        name: 'Example partner', age: 43, retirementAge: 60, pensionAccessAge: 57, taxFreeAllowance: 268275,
        assets: { pension: asset(90000, 4000), isa: asset(20000, 1500), investments: asset(10000), cash: asset(8000, 0, true) },
      },
    ],
    income: [
      { id: 'example-income-1', label: 'Illustrative later-life income', person: 0, startAge: 68, endAge: 120, annualAmount: 12000, taxable: true },
      { id: 'example-income-2', label: 'Illustrative partner later-life income', person: 1, startAge: 68, endAge: 120, annualAmount: 12000, taxable: true },
    ],
    spending: [{ id: 'example-spending', label: 'Illustrative retirement living costs', startAge: 62, endAge: 95, annualAmount: 32000 }],
    oneOffs: [],
  };
}

interface PersonYear {
  person: RetirementPerson;
  index: 0 | 1;
  age: number;
  taxableIncome: number;
  pensionTaxable: number;
}

function pensionQuote(state: PersonYear, gross: number) {
  const taxFree = Math.min(gross * 0.25, state.person.taxFreeAllowance);
  const taxable = gross - taxFree;
  const previousIncome = state.taxableIncome + state.pensionTaxable;
  const tax = incomeTax(previousIncome + taxable) - incomeTax(previousIncome);
  return { taxFree, taxable, tax, net: gross - tax };
}

function takePension(state: PersonYear, gross: number) {
  const quote = pensionQuote(state, gross);
  state.person.assets.pension.balance = Math.max(0, state.person.assets.pension.balance - gross);
  state.person.taxFreeAllowance = Math.max(0, state.person.taxFreeAllowance - quote.taxFree);
  state.pensionTaxable += quote.taxable;
  return quote;
}

/**
 * Annual real-pound projection. Opening balances grow first, then external
 * contributions and dated one-offs apply, then pooled income funds spending.
 * Contributions do not also become household spending. Pension tax is the
 * incremental tax above regular income and earlier withdrawals in that year.
 */
export function projectRetirement(plan: RetirementPlan, scenario: RetirementCase, source?: PensionCashflow): RetirementProjection {
  const errors = retirementPlanErrors(plan);
  if (errors.length) throw new Error(errors.join(' '));
  const draft = structuredClone(plan);
  const people: { person: RetirementPerson; index: 0 | 1 }[] = [{ person: draft.people[0], index: 0 }];
  if (draft.partnerEnabled) people.push({ person: draft.people[1], index: 1 });
  const projection: RetirementProjection = { scenario, years: [], firstShortfall: null, assetsAtRetirement: null };

  for (let offset = 0; offset <= draft.endAge - draft.people[0].age; offset += 1) {
    const year = draft.startYear + offset;
    const age = draft.people[0].age + offset;
    const states: PersonYear[] = people.map(({ person, index }) => ({ person, index, age: person.age + offset, taxableIncome: 0, pensionTaxable: 0 }));
    let contributions = 0;
    let income = 0;
    let tax = 0;
    let withdrawals = 0;
    let oneOffShortfall = 0;

    for (const state of states) {
      for (const key of RETIREMENT_ASSETS) {
        const asset = state.person.assets[key];
        asset.balance = Math.max(0, asset.balance * (1 + asset.returns[scenario]));
        if (state.age < state.person.retirementAge) {
          const linked = key === 'pension' ? pensionContributionForYear(draft, state.index, year, source) : null;
          const contribution = linked?.amount ?? asset.annualContribution * (1 + asset.contributionGrowth) ** offset;
          asset.balance += contribution;
          contributions += contribution;
        }
      }
    }

    for (const row of draft.income) {
      const state = states[row.person];
      if (!state || state.age < row.startAge || state.age > row.endAge) continue;
      income += row.annualAmount;
      if (row.taxable) state.taxableIncome += row.annualAmount;
    }
    tax = states.reduce((total, state) => total + incomeTax(state.taxableIncome), 0);

    // Apply deposits before withdrawals so paired rows do not depend on row order.
    const oneOffs = draft.oneOffs.filter(row => row.year === year && states[row.person]);
    for (const row of oneOffs) {
      if (row.amount > 0) states[row.person].person.assets[row.asset].balance += row.amount;
    }
    for (const row of oneOffs) {
      if (row.amount >= 0) continue;
      const state = states[row.person];
      const desired = -row.amount;
      if (row.asset === 'pension' && state.age < state.person.pensionAccessAge) {
        oneOffShortfall += desired;
        continue;
      }
      const asset = state.person.assets[row.asset];
      const gross = Math.min(desired, asset.balance);
      oneOffShortfall += desired - gross;
      if (row.asset === 'pension') tax += takePension(state, gross).tax;
      else asset.balance = Math.max(0, asset.balance - gross);
      // These proceeds leave the portfolio. A transfer requires its own deposit.
    }

    const spending = draft.spending.reduce((total, row) => total + (age >= row.startAge && age <= row.endAge ? row.annualAmount : 0), 0);
    let deficit = spending + tax - income;
    if (deficit < 0) {
      draft.people[0].assets.cash.balance -= deficit;
      deficit = 0;
    }

    // Every person's cash is available before anyone's investments/ISA/pension.
    for (const key of ['cash', 'investments', 'isa'] as const) {
      for (const state of states) {
        const asset = state.person.assets[key];
        const gross = Math.min(deficit, asset.balance);
        asset.balance = Math.max(0, asset.balance - gross);
        withdrawals += gross;
        deficit -= gross;
      }
    }
    for (const state of states) {
      if (deficit <= 0 || state.age < state.person.pensionAccessAge) continue;
      const available = state.person.assets.pension.balance;
      let gross = available;
      if (pensionQuote(state, available).net > deficit) {
        let low = 0;
        let high = available;
        for (let iteration = 0; iteration < 64; iteration += 1) {
          const middle = (low + high) / 2;
          if (pensionQuote(state, middle).net < deficit) low = middle;
          else high = middle;
        }
        gross = high;
      }
      const quote = takePension(state, gross);
      withdrawals += gross;
      tax += quote.tax;
      // Net already excludes withdrawal tax; it must not be deducted again.
      deficit = Math.max(0, deficit - quote.net);
    }

    const balances = { pension: 0, isa: 0, investments: 0, cash: 0 };
    let accessibleAssets = 0;
    for (const state of states) {
      for (const key of RETIREMENT_ASSETS) {
        const balance = state.person.assets[key].balance;
        balances[key] += balance;
        if (key !== 'pension' || state.age >= state.person.pensionAccessAge) accessibleAssets += balance;
      }
    }
    const totalAssets = RETIREMENT_ASSETS.reduce((total, key) => total + balances[key], 0);
    const shortfall = oneOffShortfall + (deficit < 1e-7 ? 0 : deficit);
    projection.years.push({ year, age, partnerAge: draft.partnerEnabled ? draft.people[1].age + offset : null, totalAssets, accessibleAssets, ...balances, contributions, income, spending, tax, withdrawals, shortfall });
    if (age === draft.people[0].retirementAge) projection.assetsAtRetirement = totalAssets;
    if (shortfall > 0 && !projection.firstShortfall) projection.firstShortfall = { year, age, amount: shortfall };
  }
  return projection;
}
