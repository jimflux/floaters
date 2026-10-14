export const RETIREMENT_ASSETS = ['pension', 'isa', 'investments', 'cash'] as const;
export const RETIREMENT_CASES = ['cautious', 'base', 'optimistic'] as const;
export type RetirementAssetKey = typeof RETIREMENT_ASSETS[number];
export type RetirementCase = typeof RETIREMENT_CASES[number];
export interface RetirementAsset {
  balance: number;
  annualContribution: number;
  contributionGrowth: number; // decimal, real growth
  returns: Record<RetirementCase, number>; // decimal, real annual returns net of fees
}
export interface RetirementPerson {
  name: string;
  age: number;
  retirementAge: number;
  pensionAccessAge: number;
  taxFreeAllowance: number; // remaining allowance in today's pounds
  assets: Record<RetirementAssetKey, RetirementAsset>;
}
export interface RetirementIncome {
  id: string;
  label: string;
  person: 0 | 1;
  startAge: number;
  endAge: number;
  annualAmount: number;
  taxable: boolean;
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
}
export interface RetirementPlan {
  version: 1;
  startYear: number;
  endAge: number;
  partnerEnabled: boolean;
  people: [RetirementPerson, RetirementPerson];
  income: RetirementIncome[];
  spending: RetirementSpending[];
  oneOffs: RetirementOneOff[];
}
export interface RetirementYear {
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
  const text = (v: unknown, label: string) => { if (typeof v !== 'string' || !v.trim() || v.length > 100) errors.push(`${label} is required (up to 100 characters).`); };
  if (!object(value)) return ['A retirement plan is required.'];
  if (value.version !== 1) errors.push('Unsupported retirement plan version.');
  number(value.startYear, 2000, 2100, 'Starting year', true);
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
      number(a.contributionGrowth, -0.5, 0.5, `${p.name} ${key} contribution growth`);
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
      }
    });
  };
  rows('income'); rows('spending'); rows('oneOffs');
  return errors;
}
