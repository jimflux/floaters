import { RETIREMENT_ASSETS, RETIREMENT_CASES, type RetirementAsset, type RetirementCase, type RetirementPlan } from '@floaters/types';

export const DEFAULT_INFLATION = 0.025;
export const FULL_STATE_PENSION_2026 = 241.30 * 52;

export function realReturn(gross: number, fee: number, inflation: number): number {
  return (1 + gross) * (1 - fee) / (1 + inflation) - 1;
}

export function assetFee(asset: RetirementAsset, priceIndex = 1): number {
  const schedule = asset.feeSchedule;
  if (!schedule) return asset.annualFee ?? 0;
  const nominal = asset.balance * priceIndex;
  const management = nominal > 0 ? (Math.min(nominal, schedule.threshold) * schedule.below
    + Math.max(0, nominal - schedule.threshold) * schedule.above) / nominal : schedule.below;
  return management + schedule.fundCost + schedule.marketSpread;
}

export function assetReturn(asset: RetirementAsset, scenario: RetirementCase, inflation: number, priceIndex = 1): number {
  return asset.grossReturns ? realReturn(asset.grossReturns[scenario], assetFee(asset, priceIndex), inflation) : asset.returns[scenario];
}

/** Recover the nominal assumptions behind legacy net real returns without changing their value. */
export function nominalReturns(asset: RetirementAsset, inflation: number): Record<RetirementCase, number> {
  return asset.grossReturns ?? Object.fromEntries(RETIREMENT_CASES.map(scenario => [scenario,
    (1 + asset.returns[scenario]) * (1 + inflation) / (1 - assetFee(asset)) - 1,
  ])) as Record<RetirementCase, number>;
}

/** Pin nominal returns before editing inflation, including cash and disabled partner assets. */
export function setRetirementInflation(draft: RetirementPlan, inflation: number): void {
  for (const person of draft.people) for (const key of RETIREMENT_ASSETS) {
    const asset = person.assets[key];
    asset.grossReturns = nominalReturns(asset, draft.inflation ?? DEFAULT_INFLATION);
    asset.annualFee ??= 0;
  }
  draft.inflation = inflation;
}

export function projectionEndAge(plan: RetirementPlan): number {
  const youngest = Math.min(...plan.people.filter((_, i) => i === 0 || plan.partnerEnabled).map(person => person.age));
  return Math.max(plan.endAge, plan.people[0].age - youngest + (plan.longevityAge ?? 0));
}

// England/Wales/NI. Personal allowance and basic limit frozen through 2030/31,
// then CPI indexation is an explicit planning assumption under current policy.
// The £100k taper and additional-rate threshold remain nominal, not CPI-linked.
// https://www.gov.uk/income-tax-rates
// https://www.gov.uk/government/publications/maintaining-income-tax-and-equivalent-national-insurance-contributions-thresholds-until-5-april-2031
export function taxBands(year = 2026, inflation = DEFAULT_INFLATION) {
  const index = (1 + inflation) ** Math.max(0, year - 2030);
  return { allowance: 12570 * index, basic: 37700 * index, taper: 100000, additional: 125140 };
}

export function incomeTax(income: number, year = 2026, inflation = DEFAULT_INFLATION): number {
  const gross = Math.max(0, income);
  const bands = taxBands(year, inflation);
  const allowance = Math.max(0, bands.allowance - Math.max(0, gross - bands.taper) / 2);
  const taxable = Math.max(0, gross - allowance);
  const basic = Math.min(taxable, bands.basic, bands.additional);
  const higher = Math.min(Math.max(0, taxable - basic), Math.max(0, bands.additional - basic));
  return basic * 0.2 + higher * 0.4 + Math.max(0, taxable - bands.additional) * 0.45;
}

/** Convert a taxable-income boundary to gross income, including the PA taper. */
export function grossTaxBoundary(taxable: number, bands: ReturnType<typeof taxBands>): number {
  if (taxable + bands.allowance <= bands.taper) return taxable + bands.allowance;
  if (taxable <= bands.taper + 2 * bands.allowance) return (taxable + bands.allowance + bands.taper / 2) / 1.5;
  return taxable;
}

/** Collect issues that need facts from the owner, rather than inventing answers. */
export function retirementInputNotes(plan: RetirementPlan): string[] {
  const notes: string[] = [];
  plan.people.forEach((person, i) => {
    if (i === 1 && !plan.partnerEnabled) return;
    const owner = i === 0 ? 'Your' : 'Partner’s';
    if (person.age < person.retirementAge && !(plan.pensionLinks ?? []).some(link => link.person === i && link.startYear <= plan.startYear)) {
      notes.push(`${owner} pension contributions are entered manually, not linked to Floaters.`);
    }
    if (person.age < person.retirementAge && person.assets.isa.annualContribution > 0) notes.push(`${owner} ISA contributions are entered manually; check the current saving amount.`);
    if (['pension', 'isa'].some(key => {
      const asset = person.assets[key as 'pension' | 'isa'];
      return asset.balance > 0 && !asset.feesConfirmed;
    })) notes.push(`${owner} investment fees need checking against the provider’s total charges.`);
  });
  if (plan.income.some(row => row.kind === 'state-pension' && !row.confirmed && (row.person === 0 || plan.partnerEnabled))) {
    notes.push('State Pension amounts are estimates. Confirm each person’s entitlement using their GOV.UK forecast.');
  }
  if (plan.spending.length && Math.max(...plan.spending.map(row => row.endAge)) < projectionEndAge(plan)) {
    notes.push('Spending ends before the household planning horizon. Check the later-life costs rather than assuming they fall to zero.');
  }
  return notes;
}
