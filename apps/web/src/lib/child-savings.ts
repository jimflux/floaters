import type { RetirementChildSavings } from '@floaters/types';

export const DEFAULT_CHILD_GROWTH = 0.05;

export interface ChildSavingsYear {
  age: number;
  year: number;
  jisa: number;
  universityFund: number;
  total: number;
  addedContributions: number;
}

/** Separate nominal illustration; child assets never fund the adult forecast. */
export function projectChildSavings(savings: RetirementChildSavings): ChildSavingsYear[] | null {
  const age = savings.ageAtBalanceDate;
  if (age === undefined) return null;
  const date = new Date(`${savings.balanceDate}T00:00:00Z`);
  const monthlyContribution = savings.monthlyUniContribution ?? 0;
  const jisaReturn = savings.jisaAnnualReturn ?? DEFAULT_CHILD_GROWTH;
  const uniReturn = savings.universityAnnualReturn ?? DEFAULT_CHILD_GROWTH;
  if (!Number.isInteger(age) || age < 0 || age > 18 || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== savings.balanceDate
    || ![savings.jisa, savings.universityFund, monthlyContribution].every(value => Number.isFinite(value) && value >= 0)
    || ![jisaReturn, uniReturn].every(value => Number.isFinite(value) && value >= -0.5 && value <= 0.5)) return null;
  const jisaMonthly = (1 + jisaReturn) ** (1 / 12);
  const uniMonthly = (1 + uniReturn) ** (1 / 12);
  let jisa = savings.jisa;
  let universityFund = savings.universityFund;
  const rows: ChildSavingsYear[] = [];
  const months = (18 - age) * 12;
  for (let month = 0; month <= months; month++) {
    if (month > 0) {
      jisa *= jisaMonthly;
      universityFund = universityFund * uniMonthly + monthlyContribution;
    }
    if (month % 12 === 0) rows.push({ age: age + month / 12, year: date.getUTCFullYear() + month / 12,
      jisa, universityFund, total: jisa + universityFund, addedContributions: month * monthlyContribution });
  }
  return rows;
}
