import type { RetirementPlan } from '@floaters/types';
import type { RetirementStress } from './retirement';

export interface RetirementMilestone {
  id: string;
  label: string;
  detail: string;
}

export interface RetirementMilestoneGroup {
  year: number;
  age: number;
  events: RetirementMilestone[];
}

/** Stagger neighbouring markers so their numbered badges never overlap. */
export function milestoneLanes(groups: RetirementMilestoneGroup[], firstAge: number, lastAge: number, chartWidth: number) {
  const laneEnds: number[] = [];
  const plotWidth = Math.max(1, chartWidth - 90);
  return groups.map(group => {
    const x = (group.age - firstAge) / Math.max(1, lastAge - firstAge) * plotWidth;
    let lane = laneEnds.findIndex(end => x - end >= 26);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = x;
    return { ...group, lane };
  });
}

const money = (amount: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(amount);

/** Calendar years and ages follow the same annual boundaries as the projection. */
export function retirementMilestones(plan: RetirementPlan, visibleYears: readonly number[], stress: RetirementStress = 'none'): RetirementMilestoneGroup[] {
  const visible = new Set(visibleYears);
  const groups = new Map<number, RetirementMilestoneGroup>();
  const enabled = (person: number) => person === 0 || plan.partnerEnabled;
  const yearAtAge = (person: number, age: number) => plan.startYear + age - plan.people[person].age;
  const deceased = plan.partnerEnabled ? stress === 'lose-you' ? 0 : stress === 'lose-partner' ? 1 : null : null;
  const alive = (person: number, year: number) => person !== deceased || year < yearAtAge(person, 85);
  const add = (year: number, event: RetirementMilestone) => {
    if (!visible.has(year)) return;
    const group = groups.get(year) ?? { year, age: plan.people[0].age + year - plan.startYear, events: [] };
    group.events.push(event);
    groups.set(year, group);
  };

  plan.people.forEach((person, index) => {
    if (!enabled(index)) return;
    const retirementYear = yearAtAge(index, person.retirementAge);
    if (alive(index, retirementYear)) add(retirementYear, { id: `retire-${index}`, label: `${person.name}: retirement`, detail: `Planned retirement at age ${person.retirementAge}. Regular savings stop at this age.` });
    const accessYear = yearAtAge(index, person.pensionAccessAge);
    if (alive(index, accessYear)) add(accessYear, { id: `access-${index}`, label: `${person.name}: pension access`, detail: `The plan allows pension withdrawals from age ${person.pensionAccessAge}. Money is drawn only when needed.` });
  });

  for (const row of plan.income) {
    if (!enabled(row.person) || row.annualAmount === 0) continue;
    const startAge = row.startAge + (stress === 'later-state-pension' && row.kind === 'state-pension' ? 2 : 0);
    const year = yearAtAge(row.person, startAge);
    if (startAge > row.endAge || !alive(row.person, year)) continue;
    const label = row.kind === 'state-pension' ? 'State Pension starts' : row.kind === 'employment' ? 'work starts' : `${row.label} starts`;
    add(year, { id: `income-${row.id}`, label: `${plan.people[row.person].name}: ${label}`, detail: `${row.label} · ${money(row.annualAmount)}/year from age ${startAge}${row.kind === 'state-pension' && !row.confirmed ? ' · entitlement unconfirmed' : ''}.` });
  }

  for (const row of plan.oneOffs) {
    if (!enabled(row.person) || row.amount === 0 || !alive(row.person, row.year)) continue;
    add(row.year, { id: `oneoff-${row.id}`, label: row.label, detail: `${plan.people[row.person].name} · planned ${money(Math.abs(row.amount))} ${row.amount > 0 ? 'into' : 'out of'} ${row.asset === 'isa' ? 'ISA' : row.asset}.` });
  }

  if (deceased !== null) add(yearAtAge(deceased, 85), { id: 'survivor', label: 'Survivor illustration begins', detail: `${plan.people[deceased].name} dies at 85 in this stress test. Income stops and the survivor inherits the assets.` });
  return [...groups.values()].sort((a, b) => a.year - b.year);
}
