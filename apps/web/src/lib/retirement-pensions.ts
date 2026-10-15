import type { CashflowData, RetirementPlan } from '@floaters/types';

export type PensionCashflow = Pick<CashflowData, 'months' | 'cashOut'>;

/** Uses cashOut's already blended payments, remainders and overrides exactly once. */
export function pensionContributionForYear(
  plan: RetirementPlan,
  person: 0 | 1,
  year: number,
  source?: PensionCashflow,
): { amount: number; estimated: boolean; extended: boolean } | null {
  if (person === 1 && !plan.partnerEnabled) return null;
  const links = plan.pensionLinks?.filter(link => link.person === person && link.startYear <= year) ?? [];
  if (!links.length) return null;
  if (!source) throw new Error('Linked pension contributions need Floaters cashflow. Load or refresh the source.');
  const { months, cashOut } = source;
  if (!Array.isArray(months) || !months.length || months.some((month, index) =>
    typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || (index > 0 && month <= months[index - 1]))) {
    throw new Error('Floaters cashflow month window is empty, invalid or out of order. Refresh the source.');
  }
  const lastIndex = months.length - 1;
  const lastMonth = months[lastIndex];
  const lastSourceYear = Number(lastMonth.slice(0, 4));
  const futureGrowth = (1 + plan.people[person].assets.pension.contributionGrowth) ** Math.max(0, year - lastSourceYear);
  let amount = 0;
  let estimated = false;
  let extended = false;

  for (const link of links) {
    const row = cashOut.find(account => account.accountCode === link.accountCode);
    if (!row || row.excluded) throw new Error(`Pension account ${link.accountCode} is missing, hidden or excluded. Restore it in Floaters or disconnect the link.`);
    for (let index = 0; index < months.length; index += 1) {
      const value = row.monthly?.[index];
      if (!Number.isFinite(value) || value < 0) throw new Error(`Pension account ${link.accountCode} month ${months[index]} has a missing, invalid or negative amount. Review the payment in Floaters and refresh.`);
      if (typeof row.isProjected?.[index] !== 'boolean') throw new Error(`Pension account ${link.accountCode} month ${months[index]} is missing its projection flag. Refresh the source.`);
    }
    for (let month = 1; month <= 12; month += 1) {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      if (key > lastMonth) {
        amount += row.monthly[lastIndex] * link.share * futureGrowth;
        estimated = true;
        extended = true;
      } else {
        const index = months.indexOf(key);
        if (index < 0) throw new Error(`Pension month ${key} is missing from Floaters cashflow. Load the full calendar year or choose a later linked starting year.`);
        amount += row.monthly[index] * link.share;
        estimated ||= row.isProjected[index];
      }
    }
  }
  return { amount, estimated, extended };
}
