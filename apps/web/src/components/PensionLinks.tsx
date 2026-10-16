import { retirementPlanErrors, type RetirementPlan, type RetirementPensionLink } from '@floaters/types';
import { pensionContributionForYear, type PensionCashflow } from '@/lib/retirement-pensions';
import { SignInRequiredError, loginUrl } from '@/lib/session';
import { Button } from '@/components/ui/button';

const INPUT = 'mt-1 w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground';
const money = (amount: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(amount);
interface Props {
  plan: RetirementPlan;
  onChange: (links: RetirementPensionLink[]) => void;
  source?: PensionCashflow;
  loading: boolean;
  error: Error | null;
  loadedAt: string | null;
  onRefresh: () => void;
}

export function PensionLinks({ plan, onChange, source, loading, error, loadedAt, onRefresh }: Props) {
  const links = plan.pensionLinks ?? [];
  const accounts = (source?.cashOut ?? []).filter(row => row.accountCode !== 'VAT_LIABILITY' && !row.excluded)
    .sort((a, b) => Number(/pension/i.test(b.accountName)) - Number(/pension/i.test(a.accountName)) || a.accountName.localeCompare(b.accountName));
  const change = (index: number, patch: Partial<RetirementPensionLink>) => onChange(links.map((link, i) => i === index ? { ...link, ...patch } : link));
  const linkErrors = retirementPlanErrors(plan).filter(message => message.startsWith('Pension'));
  return <section className="rounded-xl bg-card p-3 shadow-sm shadow-aubergine/5 sm:p-4" aria-labelledby="pension-links">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="pension-links" className="font-display text-xl font-bold">Pension links from Floaters</h2>
      <Button variant="outline" onClick={onRefresh} disabled={loading}>Refresh pension source</Button></div>
    <p className="mt-2 text-sm text-muted-foreground">Choose which company cost account funds whose pension. Links replace manual pension contributions from the chosen year; nothing is assigned automatically. Changes stay in this draft until Save plan.</p>
    {loading && <p role="status" className="mt-3 text-sm">{source ? 'Updating pension source… Previous loaded amounts remain visible while updating.' : 'Loading Floaters pension source…'}</p>}
    {loadedAt && <p className="mt-3 text-xs text-muted-foreground">Last loaded: <time dateTime={loadedAt}>{new Date(loadedAt).toLocaleString('en-GB')}</time>{source?.months.length ? ` · Source window: ${source.months[0]} to ${source.months[source.months.length - 1]}` : ''}</p>}
    {error && <div role="alert" className="mt-3 rounded-tile bg-destructive/10 p-3 text-sm"><p>Could not load the pension source. Linked projections are blocked where this source is needed. Your draft is preserved; you can save or export it and refresh to retry.</p>
      {error instanceof SignInRequiredError && <p>Your session expired. <a className="font-semibold underline" href={loginUrl()} target="_blank" rel="noreferrer">Sign in in a new tab</a>, then refresh.</p>}</div>}
    <div className="mt-2 space-y-3">{links.map((link, index) => {
      const missingAccount = !!link.accountCode && !accounts.some(row => row.accountCode === link.accountCode);
      const unavailable = !!source && missingAccount;
      return <div key={index} className="rounded-tile bg-cloud p-3"><div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <label className="min-w-0 text-xs font-semibold text-muted-foreground">Floaters cost account<select aria-label={`Pension link ${index + 1} account`} className={INPUT} value={link.accountCode} onChange={event => change(index, { accountCode: event.target.value })}>
          <option value="">Choose a cost account</option>
          {missingAccount && <option value={link.accountCode}>{link.accountCode} {source ? '(unavailable)' : '(waiting for source)'}</option>}
          {accounts.map(row => <option key={row.accountCode} value={row.accountCode}>{row.accountName} · {row.accountCode}{/pension/i.test(row.accountName) ? ' (pension name)' : ''}</option>)}</select></label>
        <label className="text-xs font-semibold text-muted-foreground">Pension recipient<select aria-label={`Pension link ${index + 1} person`} className={INPUT} value={link.person} onChange={event => change(index, { person: Number(event.target.value) as 0 | 1 })}><option value={0}>You · {plan.people[0].name}</option><option value={1}>Partner · {plan.people[1].name}{!plan.partnerEnabled ? ' (ignored while partner disabled)' : ''}</option></select></label>
        <label className="text-xs font-semibold text-muted-foreground">Share (%)<input aria-label={`Pension link ${index + 1} share`} className={INPUT} type="number" step="any" value={Number.isFinite(link.share) ? Number((link.share * 100).toFixed(6)) : ''} onChange={event => change(index, { share: event.target.value === '' ? NaN : Number(event.target.value) / 100 })} /></label>
        <label className="text-xs font-semibold text-muted-foreground">First linked year<input aria-label={`Pension link ${index + 1} starting year`} className={INPUT} type="number" value={Number.isFinite(link.startYear) ? link.startYear : ''} onChange={event => change(index, { startYear: event.target.value === '' ? NaN : Number(event.target.value) })} /></label>
        <Button variant="ghost" aria-label={`Disconnect pension link ${index + 1}`} onClick={() => onChange(links.filter((_, i) => i !== index))}>Disconnect</Button>
      </div>{unavailable && <p role="alert" className="mt-2 text-sm">Account {link.accountCode} is unavailable, hidden or excluded. Restore it in Floaters or disconnect this link.</p>}
      {link.person === 1 && !plan.partnerEnabled && <p className="mt-2 text-sm text-muted-foreground">This partner link is retained and ignored while the partner is disabled.</p>}</div>;
    })}</div>
    <Button className="mt-3" variant="outline" disabled={links.length >= 20} onClick={() => onChange([...links, { accountCode: '', person: 0, share: 1, startYear: new Date().getFullYear() }])}>Add pension link</Button>
    {!!linkErrors.length && <ul role="alert" className="mt-3 list-disc pl-5 text-sm">{linkErrors.map((message, i) => <li key={i}>{message}</li>)}</ul>}
    {!error && !linkErrors.length && ([0, 1] as const).map(person => {
      const assigned = links.filter(link => link.person === person);
      if (!assigned.length || (person === 1 && !plan.partnerEnabled)) return null;
      const year = Math.max(new Date().getFullYear(), plan.startYear, Math.min(...assigned.map(link => link.startYear)));
      const age = plan.people[person].age + year - plan.startYear;
      if (age >= plan.people[person].retirementAge) return <p key={person} className="mt-3 text-sm">{person === 0 ? 'You' : 'Partner'}: regular contributions stop at retirement age.</p>;
      try {
        const annual = pensionContributionForYear(plan, person, year, source);
        return annual && <p key={person} className="mt-3 text-sm font-semibold">{person === 0 ? 'You' : 'Partner'} · {year}: {money(annual.amount)} in actual cash payments {annual.estimated ? '(estimated: includes forecast amounts)' : '(known monthly amounts)'}{annual.extended ? ' · extended beyond source window' : ''}</p>;
      } catch (failure) {
        return <p role="alert" key={person} className="mt-3 text-sm">{failure instanceof Error ? failure.message : 'Could not calculate linked contributions.'} For missing history, update your baseline year, ages and opening balances, or link from a later year.</p>;
      }
    })}
    <details className="mt-2 space-y-2 text-xs text-muted-foreground"><summary className="cursor-pointer font-semibold">How linked contributions work</summary>
      <p>Uses saved, unexcluded Floaters cashflow. Temporary what-if exclusions do not change this source. Known payments and projected monthly amounts are already combined: paid amounts are not added again.</p>
      <p>Beyond the last forecast month, the final monthly amount repeats. In subsequent calendar years, your pension contribution growth applies. “Keep pace with inflation” also adds inflation; “Fixed cash amount” does not. Choose this under Advanced assumptions. Known source payments are never increased again. Source amounts are nominal; the retirement forecast converts them into balance-date pounds. These extensions are estimates.</p>
      <p>Balances use your chosen balance date. For a mid-month balance, linked contributions resume the following month; on the first day of a month, that month is included. Earlier payments are already covered by your balances. Do not also enter the same payments as one-offs. Linking does not query a pension provider balance or add company cash balances.</p>
      <p>Manual pension amounts are kept for years before links start and are restored when you disconnect. If the baseline predates the first link, the manual amount remains editable for those earlier years.</p>
    </details>
  </section>;
}
