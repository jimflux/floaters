import { retirementPlanErrors, type RetirementIncome, type RetirementPlan } from '@floaters/types';
import { projectionEndAge } from './retirement-assumptions';
import { projectRetirement } from './retirement';
import type { PensionCashflow } from './retirement-pensions';

export interface FireOptions { keepWork: boolean }
export interface FireCandidate {
  age: number;
  year: number;
  baseShortfallAge: number | null;
  cautiousShortfallAge: number | null;
  crashShortfallAge: number | null;
}
export interface FireAnalysis {
  candidates: FireCandidate[];
  earliestBase: number | null;
  earliestCautious: number | null;
  earliestCrash: number | null;
  endAge: number;
}

// Imported work rows predate income types. Recognise clear employment labels,
// while leaving pensions, rent and other income in place for explicit review.
export function isWorkIncome(row: RetirementIncome): boolean {
  return row.kind === 'employment' || (row.kind === undefined && !/pension/i.test(row.label)
    && /\b(work|salary|wages|employment|consulting|consultancy|part[ -]?time)\b/i.test(row.label));
}

const spendingAt = (plan: RetirementPlan, age: number) => plan.spending.reduce((total, row) =>
  total + (age >= row.startAge && age <= row.endAge ? row.annualAmount : 0), 0);

/** A detached what-if: savings stop at FIRE, with living costs from that age. */
export function firePlanAtAge(plan: RetirementPlan, retirementAge: number, options: FireOptions): RetirementPlan {
  const draft = structuredClone(plan);
  const previousAge = plan.people[0].retirementAge;
  draft.people[0].retirementAge = retirementAge;
  draft.income = draft.income.map(row => {
    if (row.person !== 0 || !isWorkIncome(row)) return row;
    row.kind = 'employment';
    if (options.keepWork) {
      // A retirement job starts with retirement; other dated work keeps its dates.
      if (row.startAge === previousAge) {
        if (retirementAge > row.endAge) row.annualAmount = 0;
        else row.startAge = retirementAge;
      }
    } else if (row.startAge >= retirementAge) row.annualAmount = 0;
    else row.endAge = Math.min(row.endAge, retirementAge - 1);
    return row;
  });

  const budget = spendingAt(plan, previousAge);
  const ids = new Set(draft.spending.map(row => row.id));
  // Top up existing early-year costs to the retirement budget. This avoids
  // both a free living-cost gap and double-counting an existing earlier budget.
  for (let age = retirementAge; age < previousAge; age++) {
    const extra = Math.max(0, budget - spendingAt(plan, age));
    if (!extra) continue;
    const previous = draft.spending[draft.spending.length - 1];
    if (previous?.label === 'FIRE living costs' && previous.endAge === age - 1 && previous.annualAmount === extra && !plan.spending.some(row => row.id === previous.id)) previous.endAge = age;
    else {
      let id = `fire-living-${age}`;
      while (ids.has(id)) id += '-';
      ids.add(id);
      draft.spending.push({ id, label: 'FIRE living costs', startAge: age, endAge: age, annualAmount: extra });
    }
  }
  return draft;
}

/** Search every whole age: dated income and one-offs make binary search unsafe. */
export function analyseFire(plan: RetirementPlan, source: PensionCashflow | undefined, minimumAge: number, options: FireOptions): FireAnalysis {
  const errors = retirementPlanErrors(plan);
  if (errors.length) throw new Error('Check your plan inputs before calculating FIRE.');
  const endAge = projectionEndAge(plan);
  if (!Number.isInteger(minimumAge) || minimumAge < plan.people[0].age || minimumAge > Math.min(100, endAge)) throw new Error('Update your balance date and ages before calculating FIRE.');
  if (spendingAt(plan, plan.people[0].retirementAge) <= 0) throw new Error('Add a household spending budget at your planned retirement age before calculating FIRE.');
  for (let age = Math.max(minimumAge, plan.people[0].retirementAge); age <= endAge; age++) {
    if (spendingAt(plan, age) <= 0) throw new Error(`Add household spending at age ${age}; FIRE needs a budget through age ${endAge}.`);
  }
  const candidates: FireCandidate[] = [];
  for (let age = minimumAge; age <= Math.min(100, endAge); age++) {
    const draft = firePlanAtAge(plan, age, options);
    const base = projectRetirement(draft, 'base', source);
    const cautious = projectRetirement(draft, 'cautious', source);
    const crash = projectRetirement(draft, 'base', source, 'market-drop');
    candidates.push({ age, year: plan.startYear + age - plan.people[0].age,
      baseShortfallAge: base.firstShortfall?.age ?? null,
      cautiousShortfallAge: cautious.firstShortfall?.age ?? null,
      crashShortfallAge: crash.firstShortfall?.age ?? null });
  }
  return { candidates, endAge,
    earliestBase: candidates.find(row => row.baseShortfallAge === null)?.age ?? null,
    earliestCautious: candidates.find(row => row.cautiousShortfallAge === null)?.age ?? null,
    earliestCrash: candidates.find(row => row.crashShortfallAge === null)?.age ?? null };
}
