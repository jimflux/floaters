import type { RetirementPlan } from '@floaters/types';
import type { FireAnalysis } from '@/lib/retirement-fire';
import { isWorkIncome } from '@/lib/retirement-fire';
import { Button } from '@/components/ui/button';

interface Props {
  plan: RetirementPlan;
  analysis: FireAnalysis | null;
  error: string;
  age: number;
  keepWork: boolean;
  onKeepWork: (value: boolean) => void;
  onAge: (age: number, view?: 'base' | 'cautious' | 'crash') => void;
  onApply: () => void;
}

export function FirePlanner({ plan, analysis, error, age, keepWork, onKeepWork, onAge, onApply }: Props) {
  const work = plan.income.filter(row => row.person === 0 && isWorkIncome(row) && row.annualAmount > 0);
  const row = analysis?.candidates.find(row => row.age === age);
  const earliest = analysis?.earliestBase;
  const percent = (value: number) => `${Number((value * 100).toFixed(2))}%`;
  return <section aria-labelledby="fire-heading" className="min-w-0 rounded-xl border border-coral/30 bg-card p-3 sm:p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="fire-heading" className="font-display text-xl font-bold">Wild mode · FIRE</h2><p className="mt-1 text-sm text-muted-foreground">Find the earliest age with no annual shortfall across your whole household plan.</p></div>
      <label className="text-xs font-semibold text-muted-foreground">Your paid work<select aria-label="FIRE paid work" className="mt-1 block rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" value={keepWork ? 'keep' : 'stop'} onChange={event => onKeepWork(event.target.value === 'keep')}><option value="stop">Stop at FIRE age</option><option value="keep">Keep the planned work income</option></select></label>
    </div>
    {error && <p role="alert" className="mt-2 rounded-md bg-coral/10 p-2 text-sm">FIRE preview unavailable: {error}</p>}
    {analysis && <>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">{[
        { label: 'Earliest · base', age: analysis.earliestBase, view: 'base' as const },
        { label: 'Earliest · cautious', age: analysis.earliestCautious, view: 'cautious' as const },
        { label: 'Earliest · base with 30% crash', age: analysis.earliestCrash, view: 'crash' as const },
      ].map(result => <button key={result.label} type="button" disabled={result.age === null} onClick={() => onAge(result.age!, result.view)} className="rounded-lg bg-iris/5 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris disabled:cursor-default">
        <span className="block text-xs font-semibold text-muted-foreground">{result.label}</span><strong className="mt-1 block text-lg">{result.age === null ? `No passing age up to ${analysis.candidates[analysis.candidates.length - 1].age}` : `Age ${result.age} · ${plan.startYear + result.age - plan.people[0].age}`}</strong>
      </button>)}</div>
      <div className="mt-3 flex flex-wrap items-end gap-3"><label className="text-xs font-semibold text-muted-foreground">Preview retirement age<select aria-label="FIRE retirement age" className="mt-1 block rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" value={age} onChange={event => onAge(Number(event.target.value))}>{analysis.candidates.map(row => <option key={row.age} value={row.age}>{row.age} · {row.year}</option>)}</select></label>
        <p className="text-sm">{row?.baseShortfallAge === null ? `Base covers planned costs through your age ${analysis.endAge}.` : `Base first shortfall: age ${row?.baseShortfallAge}.`}{earliest !== null && earliest !== undefined && <span className="ml-1 text-muted-foreground">{earliest < plan.people[0].retirementAge ? `${plan.people[0].retirementAge - earliest} years earlier than your current plan.` : 'Earliest passing base age shown above.'}</span>}<span className="block text-xs text-muted-foreground">{age < plan.people[0].pensionAccessAge ? `${plan.people[0].pensionAccessAge - age} years to bridge before your pension access age of ${plan.people[0].pensionAccessAge}.` : `Your pension access age stays at ${plan.people[0].pensionAccessAge}.`}</span></p>
        <Button className="h-8 px-3" onClick={onApply}>Use this retirement age</Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">At this preview age: cautious {row?.cautiousShortfallAge === null ? 'covers the horizon' : `first shortfall at ${row?.cautiousShortfallAge}`}; base with a 30% retirement crash {row?.crashShortfallAge === null ? 'covers the horizon' : `first shortfall at ${row?.crashShortfallAge}`}. These are scenarios, not odds of success.</p>
    </>}
    <p className="mt-2 text-xs text-muted-foreground">{keepWork && work.length ? 'Semi-retirement: planned work income is included. Retirement jobs begin at the FIRE age and keep their existing end age. ' : ''}Living costs start at FIRE. Your regular savings stop then; pension access, State Pensions, one-off dates and your partner’s retirement age stay as entered. {work.length ? `Work income ${keepWork ? 'kept' : 'stopped at FIRE'}: ${work.map(row => row.label).join(', ')}.` : 'No work income identified for you; check the income types below.'}</p>
    <p className="mt-1 text-xs text-muted-foreground">Until FIRE, your saved contribution increases still apply: pension {percent(plan.people[0].assets.pension.contributionGrowth)} and ISA {percent(plan.people[0].assets.isa.contributionGrowth)} above inflation each year. Future contributions are assumed affordable. Previewing changes the chart only; use the age, then Save plan to store the revised plan.</p>
  </section>;
}
