import type { RetirementPlan, RetirementProjection } from '@floaters/types';
import { retirementMilestones } from '@/lib/retirement-milestones';
import type { RetirementStress } from '@/lib/retirement';
import { Button } from '@/components/ui/button';
import { retirementMoney as money, RETIREMENT_ASSET_LABEL as labels } from '@/lib/retirement-format';

export function RetirementFunding({ plan, projection, caseLabel, stress, selectedYear, onYear }: {
  plan: RetirementPlan; projection: RetirementProjection; caseLabel: string; stress: RetirementStress;
  selectedYear: number; onYear: (year: number) => void;
}) {
  const selected = projection.years.find(row => row.year === selectedYear) ?? projection.years[0];
  const firstGap = projection.years.find(row => row.spendingShortfall > 0);
  const locked = Math.max(0, selected.totalAssets - selected.accessibleAssets);
  const drawNeeded = selected.withdrawals + selected.spendingShortfall;
  const events = retirementMilestones(plan, projection.years.map(row => row.year), stress)
    .map(group => ({ ...group, events: group.events.filter(event => event.kind === 'access' || event.kind === 'income') }))
    .filter(group => group.events.length);
  const retirementYear = plan.startYear + plan.people[0].retirementAge - plan.people[0].age;
  const timeline = projection.years.filter(row => row.year >= Math.min(retirementYear, selected.year));
  const ceiling = Math.max(1, ...timeline.map(row => row.totalAssets));
  return <section aria-labelledby="retirement-funding-title" className="mt-4 rounded-xl border border-border p-3 sm:p-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h3 id="retirement-funding-title" className="font-display text-lg font-bold">Funding your retirement</h3>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Accessible savings must cover the years before each pension unlocks. Private pension access and State Pension income are separate dates.</p></div>
      <label className="text-xs font-semibold text-muted-foreground">Funding year<select aria-label="Funding year" value={selected.year} onChange={event => onYear(Number(event.target.value))} className="mt-1 block rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground">
        {projection.years.map(row => <option key={row.year} value={row.year}>{row.year} · age {row.age}</option>)}
      </select></label>
    </div>
    {firstGap ? <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-destructive/10 p-3 text-sm">
      <p><strong>First funding gap: {firstGap.year} · age {firstGap.age}.</strong> {money(firstGap.spendingShortfall)} of spending and tax is unfunded in the {caseLabel.toLowerCase()} case.{firstGap.totalAssets - firstGap.accessibleAssets > 0.01 ? ' Pension money is still locked away.' : ''}</p>
      <Button size="sm" variant="outline" aria-label="Show first funding gap" onClick={() => onYear(firstGap.year)}>Show this year</Button>
    </div> : <p className="mt-3 rounded-lg bg-iris/10 p-3 text-sm">Spending and tax are funded throughout the {caseLabel.toLowerCase()} projection. Planned one-offs are checked separately below.</p>}

    <dl aria-label="Funding details" className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className="rounded-lg bg-cloud p-3"><dt className="text-xs font-semibold text-muted-foreground">Draw needed · {selected.year}</dt><dd className="mt-1 text-lg font-bold tabular-nums">{money(drawNeeded / (12 * selected.yearFraction))}/month</dd><dd className="text-xs text-muted-foreground">{money(drawNeeded)} over {selected.yearFraction < 1 ? 'the remaining year' : 'the year'}</dd></div>
      <div className="rounded-lg bg-cloud p-3"><dt className="text-xs font-semibold text-muted-foreground">Accessible at year end</dt><dd className="mt-1 text-lg font-bold tabular-nums">{money(selected.accessibleAssets)}</dd><dd className="text-xs text-muted-foreground">ISA {money(selected.isa)} · cash &amp; investments {money(selected.cash + selected.investments)}</dd></div>
      <div className="rounded-lg bg-cloud p-3"><dt className="text-xs font-semibold text-muted-foreground">Pension still locked</dt><dd className="mt-1 text-lg font-bold tabular-nums">{money(locked)}</dd><dd className="text-xs text-muted-foreground">Excluded from accessible money</dd></div>
      <div className={`rounded-lg p-3 ${selected.spendingShortfall > 0 ? 'bg-destructive/10' : 'bg-cloud'}`}><dt className="text-xs font-semibold text-muted-foreground">Unfunded spending &amp; tax</dt><dd aria-label="Unfunded spending and tax" className="mt-1 text-lg font-bold tabular-nums">{money(selected.spendingShortfall)}</dd><dd className="text-xs text-muted-foreground">This is a gap, not negative savings</dd></div>
    </dl>
    <p className="mt-2 text-xs text-muted-foreground">Draw needed is spending plus tax less income, floored at zero. It is gross withdrawals needed from savings, in balance-date pounds. The monthly figure is an average, not an exact depletion date. Planned one-offs and regular contributions are separate.</p>
    <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
      <div><dt className="text-xs text-muted-foreground">Gross income</dt><dd className="font-semibold">{money(selected.income)}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Spending + tax</dt><dd className="font-semibold">{money(selected.spending + selected.tax)}</dd></div>
      {(['cash', 'investments', 'isa', 'pension'] as const).map(key => <div key={key}><dt className="text-xs text-muted-foreground">{labels[key]} drawn</dt><dd aria-label={`${labels[key]} withdrawals`} className="font-semibold">{money(selected.withdrawalsByAsset[key])}</dd></div>)}
    </dl>
    {selected.oneOffShortfall > 0 && <p className="mt-2 rounded-md bg-destructive/10 p-2 text-sm">A further {money(selected.oneOffShortfall)} of planned one-offs cannot be funded from their selected pots.</p>}

    <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs"><span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-iris" />Accessible</span><span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-sun" />Locked pension</span><span className="font-semibold">! Unfunded year</span><span className="text-muted-foreground">Year-end balances · select a year</span></div>
    <div className="mt-2 flex gap-1 overflow-x-auto pb-2" aria-label="Accessible and locked savings by year">
      {timeline.map(row => {
        const unavailable = Math.max(0, row.totalAssets - row.accessibleAssets);
        return <button key={row.year} type="button" aria-label={`${row.year}, age ${row.age}, accessible ${money(row.accessibleAssets)}, locked pension ${money(unavailable)}${row.spendingShortfall > 0 ? `, unfunded ${money(row.spendingShortfall)}` : ''}`} aria-pressed={row.year === selected.year} onClick={() => onYear(row.year)} className={`w-14 shrink-0 rounded-md border p-1 text-center text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris ${row.year === selected.year ? 'border-iris bg-iris/10' : 'border-transparent hover:bg-cloud'}`}>
          <span className={`block h-4 font-bold ${row.spendingShortfall > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{row.spendingShortfall > 0 ? '!' : ''}</span>
          <span aria-hidden="true" className="mx-auto flex h-20 w-6 flex-col justify-end overflow-hidden rounded-sm bg-cloud"><span className="w-full bg-sun" style={{ height: `${unavailable / ceiling * 100}%` }} /><span className="w-full bg-iris" style={{ height: `${row.accessibleAssets / ceiling * 100}%` }} /></span>
          <strong className="mt-1 block">{row.year}</strong><span className="text-muted-foreground">Age {row.age}</span>
        </button>;
      })}
    </div>
    <div className="mt-3 border-t border-border pt-3"><h4 className="text-sm font-semibold">When money becomes available</h4><div className="mt-2 flex flex-wrap gap-2">
      {events.map(group => <button key={group.year} type="button" onClick={() => onYear(group.year)} aria-label={`${group.year}: ${group.events.map(event => event.label).join('; ')}`} className="max-w-full rounded-lg border border-border px-3 py-2 text-left text-xs hover:bg-cloud focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris">
        <strong>{group.year} · your age {group.age}</strong>{group.events.map(event => <span key={event.id} className="mt-1 block break-words">{event.label}<span className="block text-muted-foreground">{event.detail}</span></span>)}
      </button>)}
      {!events.length && <p className="text-xs text-muted-foreground">No new pension access or income start dates within this projection.</p>}
    </div><p className="mt-2 text-xs text-muted-foreground">These dates follow your plan and selected stress test. Annual projections do not model birthdays or the exact month money runs out.</p></div>
  </section>;
}
