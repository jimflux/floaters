import {
  RETIREMENT_ASSETS,
  retirementPlanErrors,
  type RetirementAsset,
  type RetirementAmountBasis,
  type RetirementCase,
  type RetirementPerson,
  type RetirementPlan,
  type RetirementProjection,
} from '@floaters/types';
import { pensionContributionForYear, type PensionCashflow } from './retirement-pensions';

import { assetReturn, DEFAULT_INFLATION, grossTaxBoundary, incomeTax, projectionEndAge, taxBands } from './retirement-assumptions';
export { incomeTax } from './retirement-assumptions';
export type RetirementStress = 'none' | 'market-drop' | 'weak-returns' | 'lose-you' | 'lose-partner' | 'later-state-pension';

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
    longevityAge: 100,
    inflation: DEFAULT_INFLATION,
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
  alive: boolean;
  taxableIncome: number;
  pensionTaxable: number;
  year: number;
  inflation: number;
  priceIndex: number;
}
interface PensionPot {
  state: PersonYear;
  asset: RetirementAsset;
  inherited?: boolean;
}

function pensionQuote(pot: PensionPot, gross: number) {
  const state = pot.state;
  const taxFree = pot.inherited ? 0 : Math.min(gross * 0.25, state.person.taxFreeAllowance / state.priceIndex);
  const taxable = gross - taxFree;
  const previousIncome = state.taxableIncome + state.pensionTaxable;
  const tax = (incomeTax((previousIncome + taxable) * state.priceIndex, state.year, state.inflation)
    - incomeTax(previousIncome * state.priceIndex, state.year, state.inflation)) / state.priceIndex;
  return { taxFree, taxable, tax: Math.max(0, tax), net: gross - Math.max(0, tax) };
}

function takePension(pot: PensionPot, gross: number) {
  const quote = pensionQuote(pot, gross);
  pot.asset.balance = Math.max(0, pot.asset.balance - gross);
  if (!pot.inherited) pot.state.person.taxFreeAllowance = Math.max(0, pot.state.person.taxFreeAllowance - quote.taxFree * pot.state.priceIndex);
  pot.state.pensionTaxable += quote.taxable;
  return quote;
}

// Split at tax thresholds and exhaustion of tax-free cash. Choose the next
// available tranche with the lowest marginal tax, using both people's bands.
function nextTranche(pot: PensionPot): { gross: number; rate: number } {
  const state = pot.state;
  const remaining = pot.inherited ? 0 : state.person.taxFreeAllowance / state.priceIndex;
  const previous = state.taxableIncome + state.pensionTaxable;
  const bands = taxBands(state.year, state.inflation);
  const thresholds = [grossTaxBoundary(0, bands), grossTaxBoundary(bands.basic, bands), bands.taper,
    bands.taper + bands.allowance * 2, grossTaxBoundary(bands.additional, bands)];
  const breakpoints = [pot.asset.balance, remaining * 4];
  for (const nominal of thresholds) {
    const taxable = nominal / state.priceIndex - previous;
    if (taxable > 0) breakpoints.push(pot.inherited ? taxable : taxable <= remaining * 3 ? taxable / 0.75 : taxable + remaining);
  }
  const gross = Math.min(...breakpoints.filter(amount => amount > 1e-7));
  return { gross, rate: gross > 0 ? pensionQuote(pot, gross).tax / gross : 1 };
}

function grossForNet(pot: PensionPot, net: number, limit = pot.asset.balance): number {
  if (pensionQuote(pot, limit).net <= net) return limit;
  let low = 0;
  let high = limit;
  for (let iteration = 0; iteration < 60; iteration++) {
    const middle = (low + high) / 2;
    if (pensionQuote(pot, middle).net < net) low = middle;
    else high = middle;
  }
  return high;
}

/**
 * Annual projection in balance-date pounds. Tax uses nominal income and dated
 * bands; the remaining lump-sum allowance is carried in nominal pounds.
 * Opening assets grow, then external savings, one-offs and pooled spending
 * apply. Contributions are externally funded, not charged as spending again.
 * Tax uses the UK tax year beginning in the labelled calendar year; first-year
 * regular income/tax are annualised and apportioned (not a PAYE/YTD calculation).
 */
export function projectRetirement(plan: RetirementPlan, scenario: RetirementCase, source?: PensionCashflow, stress: RetirementStress = 'none'): RetirementProjection {
  const errors = retirementPlanErrors(plan);
  if (errors.length) throw new Error(errors.join(' '));
  const draft = structuredClone(plan);
  const people: { person: RetirementPerson; index: 0 | 1 }[] = [{ person: draft.people[0], index: 0 }];
  if (draft.partnerEnabled) people.push({ person: draft.people[1], index: 1 });
  const projection: RetirementProjection = { scenario, years: [], firstShortfall: null, assetsAtRetirement: null };
  const inflation = draft.inflation ?? DEFAULT_INFLATION;
  const endAge = projectionEndAge(draft);
  const inherited = draft.people.map(person => ({ ...structuredClone(person.assets.pension), balance: 0, annualContribution: 0 }));
  let deceased: number | null = null;
  const retirementOffset = Math.max(0, draft.people[0].retirementAge - draft.people[0].age);
  const yearStart = Date.UTC(draft.startYear, 0, 1);
  const nextYearStart = Date.UTC(draft.startYear + 1, 0, 1);
  const openingDate = draft.balanceDate ? Date.parse(`${draft.balanceDate}T00:00:00Z`) : yearStart;
  const firstYearFraction = (nextYearStart - openingDate) / (nextYearStart - yearStart);

  for (let offset = 0; offset <= endAge - draft.people[0].age; offset += 1) {
    const yearFraction = offset === 0 ? firstYearFraction : 1;
    const year = draft.startYear + offset;
    const age = draft.people[0].age + offset;
    // All annual flows settle at year end, matching the growth-then-flows order.
    // Fee tiers use the opening nominal pot; tax and payments use the closing index.
    const elapsedStart = offset === 0 ? 0 : firstYearFraction + offset - 1;
    const openingPriceIndex = (1 + inflation) ** elapsedStart;
    const priceIndex = (1 + inflation) ** (elapsedStart + yearFraction);
    const realAmount = (amount: number, basis?: RetirementAmountBasis) => basis === 'nominal' ? amount / priceIndex : amount;
    // Survivor illustrations: death at 85, 70% of shared spending, all assets
    // inherited by the survivor. Death after 75 makes inherited pension taxable.
    const lostPerson = stress === 'lose-you' ? 0 : stress === 'lose-partner' ? 1 : null;
    if (draft.partnerEnabled && lostPerson !== null && deceased === null && draft.people[lostPerson].age + offset >= 85) {
      deceased = lostPerson;
      const survivor = lostPerson === 0 ? 1 : 0;
      for (const key of RETIREMENT_ASSETS) {
        const asset = draft.people[lostPerson].assets[key];
        if (key === 'pension') inherited[survivor] = { ...structuredClone(asset), annualContribution: 0 };
        else draft.people[survivor].assets[key].balance += asset.balance;
        asset.balance = 0;
      }
    }
    const states: PersonYear[] = people.map(({ person, index }) => ({ person, index, age: person.age + offset,
      alive: index !== deceased, taxableIncome: 0, pensionTaxable: 0, year, inflation, priceIndex }));
    let contributions = 0;
    const contributionsByPerson: RetirementProjection['years'][number]['contributionsByPerson'] = [
      { pension: 0, isa: 0, investments: 0, cash: 0 }, { pension: 0, isa: 0, investments: 0, cash: 0 },
    ];
    let income = 0;
    let tax = 0;
    let withdrawals = 0;
    let oneOffShortfall = 0;

    for (const state of states) {
      if (!state.alive) continue;
      const grow = (asset: RetirementAsset, invested: boolean) => {
        let rate = assetReturn(asset, scenario, inflation, openingPriceIndex);
        if (invested && stress === 'weak-returns' && offset >= retirementOffset && offset < retirementOffset + 10) rate -= 0.02;
        if (invested && stress === 'market-drop' && offset === retirementOffset) asset.balance *= 0.7;
        asset.balance = Math.max(0, asset.balance * (1 + rate) ** yearFraction);
      };
      grow(inherited[state.index], true);
      for (const key of RETIREMENT_ASSETS) {
        const asset = state.person.assets[key];
        grow(asset, key !== 'cash');
        if (state.age < state.person.retirementAge) {
          const linked = key === 'pension' ? pensionContributionForYear(draft, state.index, year, source) : null;
          const contribution = linked ? linked.amount / priceIndex : realAmount(asset.annualContribution * (1 + asset.contributionGrowth) ** elapsedStart, asset.contributionBasis) * yearFraction;
          asset.balance += contribution;
          contributions += contribution;
          contributionsByPerson[state.index][key] += contribution;
        }
      }
    }

    for (const row of draft.income) {
      const state = states[row.person];
      const delayed = stress === 'later-state-pension' && row.kind === 'state-pension' ? 2 : 0;
      if (!state?.alive || state.age < row.startAge + delayed || state.age > row.endAge) continue;
      const annualIncome = realAmount(row.annualAmount, row.amountBasis);
      income += annualIncome * yearFraction;
      // Keep annual income for pension marginal tax; regular tax below is
      // apportioned over the remaining year at the same annual income rate.
      if (row.taxable) state.taxableIncome += annualIncome;
    }
    tax = states.reduce((total, state) => total + incomeTax(state.taxableIncome * priceIndex, year, inflation) / priceIndex * yearFraction, 0);

    // Apply deposits before withdrawals so paired rows do not depend on row order.
    const oneOffs = draft.oneOffs.filter(row => row.year === year && states[row.person]?.alive);
    for (const row of oneOffs) {
      if (row.amount > 0) states[row.person].person.assets[row.asset].balance += realAmount(row.amount, row.amountBasis);
    }
    for (const row of oneOffs) {
      if (row.amount >= 0) continue;
      const state = states[row.person];
      const desired = realAmount(-row.amount, row.amountBasis);
      if (row.asset === 'pension' && state.age < state.person.pensionAccessAge) {
        oneOffShortfall += desired;
        continue;
      }
      const asset = state.person.assets[row.asset];
      const gross = Math.min(desired, asset.balance);
      oneOffShortfall += desired - gross;
      if (row.asset === 'pension') tax += takePension({ state, asset }, gross).tax;
      else asset.balance = Math.max(0, asset.balance - gross);
      // These proceeds leave the portfolio. A transfer requires its own deposit.
    }

    const spending = draft.spending.reduce((total, row) => total + (age >= row.startAge && age <= row.endAge ? row.annualAmount * yearFraction : 0), 0) * (deceased === null ? 1 : 0.7);
    let deficit = spending + tax - income;
    if (deficit < 0) {
      states.find(state => state.alive)!.person.assets.cash.balance -= deficit;
      deficit = 0;
    }

    const pots: PensionPot[] = states.filter(state => state.alive).flatMap(state => [
      ...(state.age >= state.person.pensionAccessAge ? [{ state, asset: state.person.assets.pension }] : []),
      { state, asset: inherited[state.index], inherited: true },
    ]);
    const drawPensions = (freeOnly: boolean) => {
      // Each step consumes a tax-band boundary, a pot or the remaining need.
      // A generous bound also guards against floating-point boundary loops.
      for (let step = 0; deficit > 1e-7 && step < 100; step++) {
        const choices = pots.filter(pot => pot.asset.balance > 1e-7)
          .map(pot => ({ pot, ...nextTranche(pot) })).filter(choice => !freeOnly || choice.rate < 1e-9)
          .sort((a, b) => a.rate - b.rate);
        const choice = choices[0];
        if (!choice) break;
        const gross = grossForNet(choice.pot, deficit, choice.gross);
        const quote = takePension(choice.pot, gross);
        withdrawals += gross;
        tax += quote.tax;
        deficit = Math.max(0, deficit - quote.net);
      }
    };
    const drawAssets = (key: 'cash' | 'investments' | 'isa') => {
      for (const state of states) {
        if (!state.alive) continue;
        const asset = state.person.assets[key];
        const amount = Math.min(deficit, asset.balance);
        asset.balance -= amount;
        withdrawals += amount;
        deficit -= amount;
      }
    };
    drawAssets('cash');
    drawAssets('investments');
    drawPensions(true); // use unused income-tax allowances before spending ISAs
    drawAssets('isa');
    drawPensions(false);

    const balances = { pension: 0, isa: 0, investments: 0, cash: 0 };
    let accessibleAssets = 0;
    for (const state of states) {
      balances.pension += inherited[state.index].balance;
      accessibleAssets += inherited[state.index].balance;
      for (const key of RETIREMENT_ASSETS) {
        const balance = state.person.assets[key].balance;
        balances[key] += balance;
        if (key !== 'pension' || state.age >= state.person.pensionAccessAge) accessibleAssets += balance;
      }
    }
    const totalAssets = RETIREMENT_ASSETS.reduce((total, key) => total + balances[key], 0);
    const shortfall = oneOffShortfall + (deficit < 1e-7 ? 0 : deficit);
    projection.years.push({ year, age, partnerAge: draft.partnerEnabled ? draft.people[1].age + offset : null, totalAssets, accessibleAssets, ...balances, contributions, contributionsByPerson, income, spending, tax, withdrawals, shortfall });
    if (age === draft.people[0].retirementAge) projection.assetsAtRetirement = totalAssets;
    if (shortfall > 0 && !projection.firstShortfall) projection.firstShortfall = { year, age, amount: shortfall };
  }
  return projection;
}
