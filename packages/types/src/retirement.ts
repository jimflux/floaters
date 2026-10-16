export const RETIREMENT_ASSETS = ['pension', 'isa', 'investments', 'cash'] as const;
export const RETIREMENT_CASES = ['cautious', 'base', 'optimistic'] as const;
export type RetirementAssetKey = typeof RETIREMENT_ASSETS[number];
export type RetirementCase = typeof RETIREMENT_CASES[number];
// Missing basis preserves legacy amounts in balance-date purchasing power.
export type RetirementAmountBasis = 'real' | 'nominal';
export interface RetirementAsset {
  balance: number;
  annualContribution: number;
  contributionBasis?: RetirementAmountBasis; // also governs linked payments beyond the source window
  contributionGrowth: number; // decimal annual growth, above inflation for real contributions
  returns: Record<RetirementCase, number>; // decimal, real annual returns net of fees
  grossReturns?: Record<RetirementCase, number>; // nominal, before annual fees and inflation
  annualFee?: number;
  feesConfirmed?: boolean;
  feeSchedule?: { threshold: number; below: number; above: number; fundCost: number; marketSpread: number };
}
export interface RetirementPerson {
  name: string;
  age: number;
  retirementAge: number;
  pensionAccessAge: number;
  taxFreeAllowance: number; // remaining nominal allowance as of the balance date
  assets: Record<RetirementAssetKey, RetirementAsset>;
}
export interface RetirementIncome {
  id: string;
  label: string;
  person: 0 | 1;
  startAge: number;
  endAge: number;
  annualAmount: number;
  amountBasis?: RetirementAmountBasis;
  taxable: boolean;
  kind?: 'state-pension' | 'employment' | 'other';
  confirmed?: boolean;
}
export interface RetirementSpending {
  id: string;
  label: string;
  startAge: number; // primary person's age
  endAge: number;
  annualAmount: number;
}
export interface RetirementOneOff {
  id: string;
  label: string;
  year: number;
  person: 0 | 1;
  asset: RetirementAssetKey;
  amount: number; // positive deposit / negative withdrawal from the portfolio
  amountBasis?: RetirementAmountBasis;
}
export interface RetirementPensionLink {
  accountCode: string;
  person: 0 | 1;
  share: number; // decimal allocation, greater than zero and at most one
  startYear: number;
}
export interface RetirementChildSavings {
  name: string;
  balanceDate: string;
  jisa: number;
  universityFund: number;
  ageAtBalanceDate?: number;
  monthlyUniContribution?: number; // fixed nominal amount, paid at each month end
  jisaAnnualReturn?: number; // nominal annual growth after fees, before any tax
  universityAnnualReturn?: number;
}
export interface RetirementPlan {
  version: 1;
  startYear: number;
  balanceDate?: string; // YYYY-MM-DD; legacy plans use 1 January of startYear
  endAge: number;
  longevityAge?: number; // minimum projection age for the youngest enabled adult
  inflation?: number; // annual CPI assumption, default 2.5%
  partnerEnabled: boolean;
  people: [RetirementPerson, RetirementPerson];
  income: RetirementIncome[];
  spending: RetirementSpending[];
  oneOffs: RetirementOneOff[];
  pensionLinks?: RetirementPensionLink[];
  childSavings?: RetirementChildSavings; // tracked separately; never used for retirement drawdown
}
export interface RetirementYear {
  yearFraction: number; // remaining fraction of the first year; later years are 1
  withdrawalsByAsset: Record<RetirementAssetKey, number>; // gross withdrawals for spending/tax
  spendingShortfall: number; // unmet spending and tax after income and accessible withdrawals
  oneOffShortfall: number; // blocked or insufficient planned one-off withdrawals
  year: number;
  age: number;
  partnerAge: number | null;
  totalAssets: number;
  accessibleAssets: number;
  pension: number;
  isa: number;
  investments: number;
  cash: number;
  contributions: number;
  contributionsByPerson: [Record<RetirementAssetKey, number>, Record<RetirementAssetKey, number>];
  income: number; // gross regular income
  spending: number;
  tax: number;
  withdrawals: number; // gross asset withdrawals funding spending/tax
  shortfall: number; // unmet annual cash needs; never compounded as negative assets
}
export interface RetirementProjection {
  scenario: RetirementCase;
  years: RetirementYear[];
  firstShortfall: { year: number; age: number; amount: number } | null;
  assetsAtRetirement: number | null;
}
export interface RetirementSavedPlan { plan: RetirementPlan | null; savedAt: string | null }
export interface RetirementImportResult { plan: RetirementPlan; warnings: string[] }

export function retirementPlanErrors(value: unknown): string[] {
  const errors: string[] = [];
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const number = (v: unknown, min: number, max: number, label: string, integer = false) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) errors.push(`${label} must be ${integer ? 'a whole number ' : ''}between ${min} and ${max}.`);
  };
  const basis = (v: unknown, label: string) => { if (v !== undefined && v !== 'real' && v !== 'nominal') errors.push(`${label} must use real or nominal amounts.`); };
  const text = (v: unknown, label: string) => { if (typeof v !== 'string' || !v.trim() || v.length > 100) errors.push(`${label} is required (up to 100 characters).`); };
  const readDate = (v: unknown) => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const date = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v ? date : null;
  };
  if (!object(value)) return ['A retirement plan is required.'];
  if (value.version !== 1) errors.push('Unsupported retirement plan version.');
  if (value.inflation !== undefined) number(value.inflation, 0, 0.2, 'Inflation');
  if (value.longevityAge !== undefined) number(value.longevityAge, 40, 110, 'Household planning age', true);
  number(value.startYear, 2000, 2100, 'Starting year', true);
  if (value.balanceDate !== undefined) {
    const date = readDate(value.balanceDate);
    if (!date || date.getUTCFullYear() !== value.startYear) {
      errors.push('Balance date must be a valid date in the starting year.');
    }
  }
  if (value.childSavings !== undefined) {
    const savings = value.childSavings;
    if (!object(savings)) errors.push('Child savings must contain a name, balance date, JISA and uni fund.');
    else {
      text(savings.name, 'Child’s name');
      number(savings.jisa, 0, 100000000, 'Child JISA balance');
      number(savings.universityFund, 0, 100000000, 'Child uni fund balance');
      if (savings.ageAtBalanceDate !== undefined) number(savings.ageAtBalanceDate, 0, 18, 'Child age at balance date', true);
      if (savings.monthlyUniContribution !== undefined) number(savings.monthlyUniContribution, 0, 100000, 'Child monthly uni contribution');
      if (savings.jisaAnnualReturn !== undefined) number(savings.jisaAnnualReturn, -0.5, 0.5, 'Child JISA annual growth');
      if (savings.universityAnnualReturn !== undefined) number(savings.universityAnnualReturn, -0.5, 0.5, 'Child uni fund annual growth');
      const date = readDate(savings.balanceDate);
      if (!date || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) errors.push('Child balance date must be a valid date between 2000 and 2100.');
    }
  }
  number(value.endAge, 40, 120, 'End age', true);
  if (typeof value.partnerEnabled !== 'boolean') errors.push('Partner setting is required.');
  if (!Array.isArray(value.people) || value.people.length !== 2) return [...errors, 'Exactly two person profiles are required (partner may be disabled).'];
  value.people.forEach((p, i) => {
    if (!object(p)) { errors.push(`Person ${i + 1} is missing.`); return; }
    text(p.name, `Person ${i + 1} name`);
    number(p.age, 18, 100, `${p.name} age`, true);
    number(p.retirementAge, 18, 100, `${p.name} retirement age`, true);
    number(p.pensionAccessAge, 18, 75, `${p.name} pension access age`, true);
    number(p.taxFreeAllowance, 0, 2000000, `${p.name} remaining tax-free allowance`);
    if (i === 0 && typeof p.age === 'number' && typeof value.endAge === 'number' && p.age > value.endAge) errors.push('End age must be at least your current age.');
    if (!object(p.assets)) { errors.push(`${p.name} assets are missing.`); return; }
    for (const key of RETIREMENT_ASSETS) {
      const a = p.assets[key];
      if (!object(a)) { errors.push(`${p.name} ${key} is missing.`); continue; }
      number(a.balance, 0, 100000000, `${p.name} ${key} balance`);
      number(a.annualContribution, 0, 1000000, `${p.name} ${key} contribution`);
      basis(a.contributionBasis, `${p.name} ${key} contribution basis`);
      number(a.contributionGrowth, -0.5, 0.5, `${p.name} ${key} contribution growth`);
      if (a.annualFee !== undefined) number(a.annualFee, 0, 0.1, `${p.name} ${key} annual fee`);
      if (a.feesConfirmed !== undefined && typeof a.feesConfirmed !== 'boolean') errors.push('Fee confirmation must be true or false.');
      if (a.feeSchedule !== undefined) {
        if (!object(a.feeSchedule)) errors.push(`${p.name} ${key} fee schedule is invalid.`);
        else {
          number(a.feeSchedule.threshold, 1, 10000000, 'Fee tier threshold');
          for (const field of ['below', 'above', 'fundCost', 'marketSpread']) number(a.feeSchedule[field], 0, 0.1, `Fee schedule ${field}`);
        }
        if (a.grossReturns === undefined) errors.push('Tiered fees require gross return assumptions.');
      }
      if (a.grossReturns !== undefined) {
        if (!object(a.grossReturns)) errors.push(`${p.name} ${key} gross returns are missing.`);
        else for (const scenario of RETIREMENT_CASES) number(a.grossReturns[scenario], -0.5, 0.5, `${p.name} ${key} ${scenario} gross return`);
        if (a.annualFee === undefined && a.feeSchedule === undefined) errors.push(`${p.name} ${key} annual fee is required with gross returns.`);
      }
      if (!object(a.returns)) errors.push(`${p.name} ${key} returns are missing.`);
      else for (const scenario of RETIREMENT_CASES) number(a.returns[scenario], -0.5, 0.5, `${p.name} ${key} ${scenario} return`);
    }
  });
  const rows = (key: 'income' | 'spending' | 'oneOffs') => {
    const entries = value[key];
    if (!Array.isArray(entries) || entries.length > 100) { errors.push(`${key} must contain up to 100 rows.`); return; }
    const ids = new Set<string>();
    entries.forEach((r, i) => {
      if (!object(r)) { errors.push(`${key} row ${i + 1} is missing.`); return; }
      if (key !== 'spending') basis(r.amountBasis, `${key} amount basis`);
      text(r.id, `${key} row id`); text(r.label, `${key} row label`);
      if (typeof r.id === 'string' && ids.has(r.id)) errors.push(`${key} row ids must be unique.`);
      if (typeof r.id === 'string') ids.add(r.id);
      if (key !== 'spending' && r.person !== 0 && r.person !== 1) errors.push(`${key} row person must be you or your partner.`);
      if (key === 'oneOffs') {
        number(r.year, 2000, 2220, 'One-off year', true);
        number(r.amount, -100000000, 100000000, 'One-off amount');
        if (!RETIREMENT_ASSETS.includes(r.asset as RetirementAssetKey)) errors.push('One-off asset bucket is invalid.');
      } else {
        number(r.startAge, 18, 120, 'Start age', true); number(r.endAge, 18, 120, 'End age', true);
        number(r.annualAmount, 0, 1000000, 'Annual amount');
        if (typeof r.startAge === 'number' && typeof r.endAge === 'number' && r.startAge > r.endAge) errors.push(`${r.label} end age must be after its start age.`);
        if (key === 'income' && typeof r.taxable !== 'boolean') errors.push('Income tax setting is required.');
        if (key === 'income' && r.kind !== undefined && !['state-pension', 'employment', 'other'].includes(r.kind as string)) errors.push('Income kind is invalid.');
        if (key === 'income' && r.confirmed !== undefined && typeof r.confirmed !== 'boolean') errors.push('Income confirmation must be true or false.');
        if (key === 'income' && r.kind === 'state-pension' && r.taxable !== true) errors.push('State Pension income must be taxable.');
      }
    });
  };
  rows('income'); rows('spending'); rows('oneOffs');
  if (value.pensionLinks !== undefined) {
    if (!Array.isArray(value.pensionLinks) || value.pensionLinks.length > 20) errors.push('Pension links must contain up to 20 mappings.');
    else {
      const recipients = new Map<string, Set<unknown>>();
      const allocations = new Map<string, number>();
      value.pensionLinks.forEach((link, index) => {
        const label = `Pension link ${index + 1}`;
        if (!object(link)) { errors.push(`${label} is missing.`); return; }
        text(link.accountCode, `${label} account code`);
        if (link.person !== 0 && link.person !== 1) errors.push(`${label} person must be you or your partner.`);
        number(link.share, 0, 1, `${label} share`);
        if (link.share === 0) errors.push(`${label} share must be greater than zero.`);
        number(link.startYear, 2000, 2220, `${label} starting year`, true);
        if (typeof link.accountCode === 'string') {
          const people = recipients.get(link.accountCode) ?? new Set<unknown>();
          if (people.has(link.person)) errors.push(`${label} duplicates an account and person mapping.`);
          people.add(link.person);
          recipients.set(link.accountCode, people);
          if (typeof link.share === 'number' && Number.isFinite(link.share)) allocations.set(link.accountCode, (allocations.get(link.accountCode) ?? 0) + link.share);
        }
      });
      for (const [account, share] of allocations) {
        if (share > 1 + 1e-9) errors.push(`Pension account ${account} allocations must not exceed 100%.`);
      }
    }
  }
  return errors;
}
