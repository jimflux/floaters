import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  RETIREMENT_ASSETS, RETIREMENT_CASES, retirementPlanErrors,
  type RetirementCase, type RetirementPlan, type RetirementProjection,
} from '@floaters/types';
import { getRetirementPlan, saveRetirementPlan } from '@/lib/api';
import { assetFee, assetReturn, DEFAULT_INFLATION, FULL_STATE_PENSION_2026, projectionEndAge, retirementInputNotes } from '@/lib/retirement-assumptions';
import { createExampleRetirementPlan, projectRetirement, type RetirementStress } from '@/lib/retirement';
import { importRetirementJson, importRetirementWorkbook, MAX_RETIREMENT_FILE_BYTES } from '@/lib/retirement-import';
import { Button } from '@/components/ui/button';
import { SignInRequiredError, loginUrl } from '@/lib/session';
import { PensionLinks } from '@/components/PensionLinks';
import { usePensionCashflow } from '@/hooks/usePensionCashflow';

const INPUT = 'w-full min-w-0 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-iris';
const CARD = 'rounded-xl bg-card p-3 shadow-sm shadow-aubergine/5 sm:p-4';
const CASE_LABEL: Record<RetirementCase, string> = { cautious: 'Cautious', base: 'Base', optimistic: 'Optimistic' };
const CASE_COLOR: Record<RetirementCase, string> = { cautious: 'hsl(var(--coral))', base: 'hsl(var(--iris-deep))', optimistic: 'hsl(var(--aubergine))' };
const STRESS_LABEL: Record<RetirementStress, string> = { none: 'Normal outlook', 'market-drop': 'Market drop at retirement', 'weak-returns': 'Ten difficult investment years', 'later-state-pension': 'State Pension two years later', 'lose-you': 'Partner survives you', 'lose-partner': 'You survive your partner' };
const STRESS_NOTE: Record<RetirementStress, string> = { none: 'Amounts are in today’s pounds, after inflation and investment fees.', 'market-drop': 'Illustration: invested assets fall 30% at retirement, then follow the selected return case. Cash is unaffected.', 'weak-returns': 'Illustration: invested returns are two percentage points lower for the first ten retirement years. Cash is unaffected.', 'later-state-pension': 'Illustration: each State Pension starts two years later. Amounts and other income stay the same.', 'lose-you': 'Illustration: you die at 85. Your income stops and household spending falls to 70%. Your partner inherits your assets; inherited pension withdrawals are fully taxable. Estate taxes and scheme restrictions are not modelled.', 'lose-partner': 'Illustration: your partner dies at 85. Their income stops and household spending falls to 70%. You inherit their assets; inherited pension withdrawals are fully taxable. Estate taxes and scheme restrictions are not modelled.' };
const ASSET_LABEL = { pension: 'Pension', isa: 'ISA', investments: 'Investments', cash: 'Cash' };
const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const money = (value: number) => currency.format(value);
const rowId = () => globalThis.crypto?.randomUUID?.() ?? `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function NumberField({ label, value, onChange, percent = false, compact = false, disabled = false }: { disabled?: boolean; label: string; value: number; onChange: (value: number) => void; percent?: boolean; compact?: boolean }) {
  return <label className="block min-w-0 text-xs font-semibold text-muted-foreground"><span className={compact ? 'sr-only' : ''}>{label}</span>
    <input aria-label={label} disabled={disabled} type="number" step="any" className={`${INPUT} mt-1 font-normal tabular-nums`}
      value={Number.isFinite(value) ? (percent ? Number((value * 100).toFixed(6)) : value) : ''}
      onChange={event => onChange(event.target.value.trim() === '' ? NaN : Number(event.target.value) / (percent ? 100 : 1))} />
  </label>;
}
function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block min-w-0 text-xs font-semibold text-muted-foreground">{label}
    <input aria-label={label} className={`${INPUT} mt-1 font-normal`} value={value} onChange={event => onChange(event.target.value)} />
  </label>;
}

export default function RetirementPage({ active = true }: { active?: boolean }) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const today = `${currentYear}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const pension = usePensionCashflow(active);
  const [plan, setPlan] = useState<RetirementPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [signInRequired, setSignInRequired] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [example, setExample] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [saveSignInRequired, setSaveSignInRequired] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [stress, setStress] = useState<RetirementStress>('none');
  const effectiveStress = !plan?.partnerEnabled && (stress === 'lose-you' || stress === 'lose-partner') ? 'none' : stress;
  const [detailCase, setDetailCase] = useState<RetirementCase>('base');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const workbookInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    setSignInRequired(false);
    getRetirementPlan().then(result => {
      if (!active) return;
      const next = result.plan ?? createExampleRetirementPlan(new Date().getFullYear());
      setPlan(structuredClone(next));
      setSavedFingerprint(result.plan ? JSON.stringify(result.plan) : null);
      setSavedAt(result.savedAt);
      setExample(!result.plan);
      setSelectedYear(Math.max(next.startYear, new Date().getFullYear()));
    }).catch(error => {
      if (!active) return;
      setLoadError(true);
      setSignInRequired(error instanceof SignInRequiredError);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadAttempt]);

  const fingerprint = useMemo(() => JSON.stringify(plan), [plan]);
  const errors = useMemo(() => {
    if (!plan) return [];
    const errors = retirementPlanErrors(plan);
    if (new Blob([fingerprint]).size > 100 * 1024) errors.push('The plan exceeds the 100 KB save and JSON import limit. Remove some rows or shorten labels.');
    return errors;
  }, [plan, fingerprint]);
  const { projections, projectionError } = useMemo(() => {
    if (!plan || errors.length) return { projections: null, projectionError: '' };
    try {
      const projections = Object.fromEntries(RETIREMENT_CASES.map(scenario => [scenario,
        projectRetirement(plan, scenario, pension.error ? undefined : pension.source, effectiveStress)])) as Record<RetirementCase, RetirementProjection>;
      return { projections, projectionError: '' };
    } catch (error) {
      return { projections: null, projectionError: error instanceof Error ? error.message : 'Could not calculate the retirement projection.' };
    }
  }, [plan, errors, pension.source, pension.error, effectiveStress]);
  const chartData = useMemo(() => projections?.base.years.flatMap((row, index, years) =>
    row.year >= currentYear || years[years.length - 1].year < currentYear ? [{ age: row.age,
      cautious: projections.cautious.years[index].totalAssets, base: row.totalAssets, optimistic: projections.optimistic.years[index].totalAssets }] : []), [projections, currentYear]);
  const inputErrors = errors.filter(message => !message.startsWith('Pension'));
  const dirty = !!plan && fingerprint !== savedFingerprint;
  const ready = !!plan && !loading && !loadError;
  const valid = ready && !errors.length;
  const inputNotes = plan ? retirementInputNotes(plan) : [];
  const endAge = plan ? projectionEndAge(plan) : 100;
  const detail = projections?.[detailCase];
  const selected = detail?.years.find(row => row.year === selectedYear) ?? detail?.years[0];

  const edit = (change: (draft: RetirementPlan) => void) => {
    setPlan(current => {
      if (!current) return current;
      const draft = structuredClone(current);
      change(draft);
      return draft;
    });
    setSaveSuccess(false);
    setSaveError(false);
  };
  const changeBalanceDate = (date: string) => edit(draft => {
    draft.balanceDate = date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const year = Number(date.slice(0, 4));
    const yearDelta = year - draft.startYear;
    draft.people.forEach(person => { person.age += yearDelta; });
    draft.startYear = year;
  });
  const save = async () => {
    if (!plan || !valid || saving || importing) return;
    const submitted = structuredClone(plan);
    setSaving(true); setSaveError(false); setSaveSignInRequired(false); setSaveSuccess(false);
    try {
      const result = await saveRetirementPlan(submitted);
      setSavedFingerprint(JSON.stringify(submitted));
      setSavedAt(result.savedAt);
      setExample(false);
      setSaveSuccess(true);
    } catch (error) { setSaveError(true); setSaveSignInRequired(error instanceof SignInRequiredError); }
    finally { setSaving(false); }
  };
  const importFile = async (event: ChangeEvent<HTMLInputElement>, kind: 'workbook' | 'json') => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || !ready) { input.value = ''; return; }
    setImportError(''); setImporting(true); setSaveSuccess(false);
    try {
      const limit = kind === 'workbook' ? MAX_RETIREMENT_FILE_BYTES : 100 * 1024;
      if (file.size > limit) throw new Error(kind === 'workbook' ? 'Workbook must be no larger than 5 MB.' : 'JSON plan must be no larger than 100 KB.');
      // Let the importing state paint before parsing a workbook on the main thread.
      await new Promise(resolve => setTimeout(resolve, 0));
      const result = kind === 'workbook' ? importRetirementWorkbook(await file.arrayBuffer()) : importRetirementJson(await file.text());
      const importedErrors = retirementPlanErrors(result.plan);
      if (importedErrors.length) throw new Error(importedErrors.slice(0, 4).join(' '));
      setPlan(structuredClone(result.plan));
      setSelectedYear(Math.max(result.plan.startYear, currentYear));
      setWarnings(result.warnings);
      setExample(false); setSaveError(false);
    } catch (error) { setImportError(error instanceof Error ? error.message : 'Could not import this file.'); }
    finally { setImporting(false); input.value = ''; }
  };
  const exportJson = () => {
    if (!plan || !valid) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `retirement-plan-${plan.startYear}.json`;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return <main className="min-h-screen bg-background text-foreground">
    <header className="flex flex-col justify-between gap-3 bg-aubergine px-3 py-3 text-cloud sm:px-4 lg:flex-row lg:items-center">
      <div><h1 className="font-display text-2xl font-extrabold tracking-tight text-cloud">Retirement planner</h1><p className="mt-1 text-sm text-cloud/75">Your retirement outlook · Update your JPM balances whenever you like</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="border-cloud/40 bg-transparent text-cloud hover:bg-cloud/10 hover:text-cloud" disabled={!ready || importing || saving} onClick={() => workbookInput.current?.click()}>Import workbook</Button>
        <Button variant="outline" className="border-cloud/40 bg-transparent text-cloud hover:bg-cloud/10 hover:text-cloud" disabled={!ready || importing || saving} onClick={() => jsonInput.current?.click()}>Import JSON</Button>
        <Button variant="outline" className="border-cloud/40 bg-transparent text-cloud hover:bg-cloud/10 hover:text-cloud" disabled={!valid || importing} onClick={exportJson}>Export JSON</Button>
        <Button disabled={!valid || saving || importing} onClick={save}>{saving ? 'Saving…' : 'Save plan'}</Button>
      </div>
    </header>
    <input ref={workbookInput} type="file" accept=".xlsx" aria-label="Workbook file" className="hidden" disabled={!ready || importing || saving} onChange={event => void importFile(event, 'workbook')} />
    <input ref={jsonInput} type="file" accept=".json,application/json" aria-label="JSON plan file" className="hidden" disabled={!ready || importing || saving} onChange={event => void importFile(event, 'json')} />
    <div className="w-full space-y-3 px-3 py-3 sm:px-4">
      {loading && <p role="status">Loading your retirement plan…</p>}
      {loadError && <div role="alert" className={`${CARD} space-y-3`}><p>Could not load your saved plan. Retry before importing or saving.</p>
        {signInRequired && <a href={loginUrl()} className="font-semibold underline">Sign in</a>}
        <Button onClick={() => setLoadAttempt(value => value + 1)}>Retry loading</Button></div>}
      {ready && plan && <fieldset disabled={importing} className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="font-semibold">{dirty ? 'Unsaved changes' : 'Saved'}{savedAt && <span className="ml-2 font-normal text-muted-foreground">{new Date(savedAt).toLocaleString('en-GB')}</span>}</p>
          <p className="text-muted-foreground">Imports stay on this device until you choose Save plan.</p>
        </div>
        {example && <p className="rounded-tile bg-sun/20 p-4 text-sm">Example plan — invented values for illustration. Edit or import your own inputs; this example is unsaved.</p>}
        {saving && <p role="status">Saving your submitted plan… You can keep editing.</p>}
        {saveSuccess && <p role="status">{dirty ? 'Saved snapshot. Your later edits are still unsaved changes.' : 'Plan saved.'}</p>}
        {saveError && <div role="alert" className="rounded-tile bg-destructive/10 p-3">
          {saveSignInRequired ? <p>Your session expired. Your draft is still here. <a className="font-semibold underline" href={loginUrl()} target="_blank" rel="noreferrer">Sign in in a new tab</a>, then choose Save plan again. You can also export your draft.</p>
            : <p>Could not save your plan. Your draft is preserved; choose Save plan to retry.</p>}
        </div>}
        {importing && <p role="status">Importing file…</p>}
        {importError && <p role="alert" className="rounded-tile bg-destructive/10 p-3">{importError}</p>}
        {!!warnings.length && <div className="rounded-tile bg-sun/20 p-4"><h2 className="font-semibold">Review imported inputs</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
        {!!inputErrors.length && <div role="alert" className="rounded-tile bg-destructive/10 p-4"><h2 className="font-semibold">Check these inputs before projecting or saving</h2><ul className="mt-2 list-disc pl-5 text-sm">{inputErrors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}

        {detail && selected && <section className={CARD} aria-labelledby="projection-results">
          <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="projection-results" className="font-display text-xl font-bold">Projected assets by age</h2><p className="mt-1 text-sm text-muted-foreground">Three illustrative return cases, not probabilities.</p></div>
            <label className="text-xs font-semibold text-muted-foreground">Detail case<select aria-label="Detail case" className={`${INPUT} mt-1`} value={detailCase} onChange={event => setDetailCase(event.target.value as RetirementCase)}>{RETIREMENT_CASES.map(scenario => <option key={scenario} value={scenario}>{CASE_LABEL[scenario]}</option>)}</select></label>
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-3"><label className="text-xs font-semibold text-muted-foreground">Stress test<select aria-label="Stress test" className={`${INPUT} mt-1`} value={effectiveStress} onChange={event => setStress(event.target.value as RetirementStress)}>{Object.entries(STRESS_LABEL).filter(([key]) => plan.partnerEnabled || (key !== 'lose-you' && key !== 'lose-partner')).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><p className="max-w-3xl text-sm text-muted-foreground">{STRESS_NOTE[effectiveStress]}</p></div>
          <p className="mt-3 text-xs text-muted-foreground">Plans through your age {endAge}{plan.partnerEnabled ? ` and your partner’s age ${plan.people[1].age + endAge - plan.people[0].age}` : ''}. Balances shown are gross of future withdrawal tax.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-tile bg-cloud p-4"><p className="text-xs font-semibold text-muted-foreground">First annual shortfall · {CASE_LABEL[detailCase]}</p><p className="mt-2 text-lg font-bold">{detail.firstShortfall ? `Age ${detail.firstShortfall.age} · ${detail.firstShortfall.year}` : `No shortfall through age ${endAge}`}</p>{detail.firstShortfall && <p className="text-sm">{money(detail.firstShortfall.amount)} unmet</p>}</div>
            <div className="rounded-tile bg-cloud p-4"><p className="text-xs font-semibold text-muted-foreground">Year-end assets at retirement · age {plan.people[0].retirementAge}</p><p className="mt-2 text-lg font-bold">{detail.assetsAtRetirement === null ? 'Outside projection range' : money(detail.assetsAtRetirement)}</p></div>
            <div className="rounded-tile bg-cloud p-4"><p className="text-xs font-semibold text-muted-foreground">Accessible assets in {selected.year} · age {selected.age}</p><p className="mt-2 text-lg font-bold">{money(selected.accessibleAssets)}</p><p className="text-xs text-muted-foreground">Excludes pensions before each person’s access age.</p></div>
          </div>
          <div className="mt-3 h-[260px] w-full min-w-0 sm:h-[300px]" role="img" aria-label="Cautious, base and optimistic projected household assets by your age">
            <ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 10, right: 10, left: 5, bottom: 10 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="age" tickLine={false} /><YAxis width={72} tickFormatter={value => `£${Math.round(Number(value) / 1000)}k`} tickLine={false} /><Tooltip formatter={(value: unknown) => money(Number(value))} labelFormatter={value => `Age ${value}`} /><Legend formatter={value => <span className="text-foreground">{value}</span>} />{RETIREMENT_CASES.map(scenario => <Line key={scenario} type="monotone" dataKey={scenario} name={CASE_LABEL[scenario]} stroke={CASE_COLOR[scenario]} strokeWidth={2} strokeDasharray={scenario === 'cautious' ? '5 4' : scenario === 'optimistic' ? '2 4' : undefined} dot={false} isAnimationActive={false} />)}</LineChart></ResponsiveContainer>
          </div>
          <details className="mt-3 border-t border-border pt-4"><summary className="cursor-pointer font-semibold">Annual breakdown</summary>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-3"><h3 className="font-display text-lg font-bold">Annual detail · {CASE_LABEL[detailCase]}</h3><label className="text-xs font-semibold text-muted-foreground">Selected year<select aria-label="Selected year" className={`${INPUT} mt-1`} value={selected.year} onChange={event => setSelectedYear(Number(event.target.value))}>{detail.years.map(row => <option key={row.year} value={row.year}>{row.year} · age {row.age}</option>)}</select></label></div>
          <p className="mt-2 text-xs text-muted-foreground">Year-end balances. Withdrawals fund spending and tax; separate one-off outflows are already deducted from their buckets. Shortfall includes unmet spending and blocked or insufficient one-offs.</p>
          <div className="mt-3 max-h-[560px] overflow-auto"><table className="w-full min-w-[1400px] text-right text-xs tabular-nums"><caption className="sr-only">Annual retirement projection in today’s pounds</caption><thead className="sticky top-0 bg-card"><tr>{['Year', 'Your age', 'Partner age', 'Total assets', 'Accessible', 'Pension', 'ISA', 'Investments', 'Cash', 'Contributions', 'Gross income', 'Spending', 'Tax', 'Withdrawals', 'Shortfall'].map(label => <th key={label} scope="col" className="whitespace-nowrap border-b border-border px-3 py-3 font-semibold">{label}</th>)}</tr></thead><tbody>{detail.years.map(row => <tr key={row.year} aria-selected={row.year === selected.year} className={`border-b border-border ${row.year === selected.year ? 'bg-iris/10' : ''}`}><th scope="row" className="px-3 py-2"><button className="font-semibold underline decoration-transparent hover:decoration-current" aria-label={`Select year ${row.year}`} onClick={() => setSelectedYear(row.year)}>{row.year}</button></th><td className="px-3 py-2">{row.age}</td><td className="px-3 py-2">{row.partnerAge ?? '—'}</td>{(['totalAssets', 'accessibleAssets', 'pension', 'isa', 'investments', 'cash', 'contributions', 'income', 'spending', 'tax', 'withdrawals', 'shortfall'] as const).map(key => <td key={key} className={`whitespace-nowrap px-3 py-2 ${key === 'shortfall' && row.shortfall > 0 ? 'font-bold text-foreground bg-destructive/10' : ''}`}>{money(row[key])}</td>)}</tr>)}</tbody></table></div>
          </details>
        </section>}

        {!!inputNotes.length && <details className={`${CARD} border border-sun/50`}><summary className="cursor-pointer font-semibold">Inputs to check · {inputNotes.length}</summary><ul className="mt-3 list-disc space-y-2 pl-5 text-sm">{inputNotes.map(note => <li key={note}>{note}</li>)}</ul></details>}

        <section className={CARD} aria-labelledby="balance-inputs">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 id="balance-inputs" className="font-display text-xl font-bold">Pension &amp; ISA balances</h2><p className="mt-1 text-sm text-muted-foreground">Copy the balances from JPM whenever you want to update your plan.</p></div>
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={plan.partnerEnabled} onChange={event => edit(draft => { draft.partnerEnabled = event.target.checked; })} />Include partner</label>
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block text-xs font-semibold text-muted-foreground">Balances as of<input aria-label="Balances as of" type="date" className={`${INPUT} mt-1`} value={plan.balanceDate ?? `${plan.startYear}-01-01`} onChange={event => changeBalanceDate(event.target.value)} /></label>
            <Button variant="outline" onClick={() => changeBalanceDate(today)}>Use today</Button>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">All balances should be from this date. Changing the date keeps your entered amounts, so check other savings and your partner’s balances too. The forecast only adds growth and savings after this date.</p>
          <div className={`mt-3 grid gap-3 ${plan.partnerEnabled ? 'md:grid-cols-2' : ''}`}>{plan.people.map((person, index) => {
            const owner = index === 0 ? 'You' : 'Partner';
            const pensionLinkedAtBaseline = (plan.pensionLinks ?? []).some(link => link.person === index && link.startYear <= plan.startYear);
            return (index === 0 || plan.partnerEnabled) && <div key={index} className="min-w-0 rounded-lg border border-border p-3">
              <h3 className="font-display text-lg font-bold">{owner}</h3>
              <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_6rem]">
                <TextField label={`${owner} name`} value={person.name} onChange={value => edit(draft => { draft.people[index].name = value; })} />
                <NumberField label={`${owner} current age`} value={person.age + currentYear - plan.startYear} onChange={value => edit(draft => { draft.people[index].age = value - (currentYear - draft.startYear); })} />
                <NumberField label={`${owner} retirement age`} value={person.retirementAge} onChange={value => edit(draft => { draft.people[index].retirementAge = value; })} />
              </div>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {(['pension', 'isa'] as const).map(key => <div key={key} className="rounded-lg bg-iris/10 p-2.5"><p className="font-semibold text-sm">{ASSET_LABEL[key]}</p><NumberField compact label={`${owner} ${key} balance`} value={person.assets[key].balance} onChange={value => edit(draft => { draft.people[index].assets[key].balance = value; })} /></div>)}
              </div>
              <details className="mt-2 rounded-lg border border-border px-3 py-2"><summary className="cursor-pointer text-sm font-semibold">{owner === 'You' ? 'Your' : 'Partner’s'} other savings and contributions</summary>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">{(['investments', 'cash'] as const).map(key => <NumberField key={key} label={`${owner} ${key} balance`} value={person.assets[key].balance} onChange={value => edit(draft => { draft.people[index].assets[key].balance = value; })} />)}</div>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">{RETIREMENT_ASSETS.map(key => <NumberField key={key} disabled={key === 'pension' && pensionLinkedAtBaseline} label={`${owner} ${key} annual contribution`} value={person.assets[key].annualContribution} onChange={value => edit(draft => { draft.people[index].assets[key].annualContribution = value; })} />)}</div>
                {pensionLinkedAtBaseline && <p className="mt-3 text-sm text-muted-foreground">Pension contributions use your Floaters links. Disconnecting restores the manual amount.</p>}
              </details>
            </div>;
          })}</div>
          <div className="mt-3 flex flex-wrap items-center gap-3"><Button className="h-8 px-3" disabled={!valid || !dirty || saving || importing} onClick={save}>{saving ? 'Saving…' : 'Save balances'}</Button><p className="text-sm text-muted-foreground">Saves these balances and the rest of your plan.</p></div>
        </section>

        <section className={`${CARD} border border-iris/20`} aria-labelledby="child-savings">
          <h2 id="child-savings" className="break-words font-display text-xl font-bold">{plan.childSavings?.name.trim() ? `${plan.childSavings.name}’s savings` : 'Children’s savings'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Tracked separately from your retirement forecast and household spending. These balances save with the rest of your plan.</p>
          {plan.childSavings ? <div className="mt-3 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(8rem,1fr)_10rem_minmax(7rem,1fr)_minmax(7rem,1fr)_auto]">
            <TextField label="Child’s name" value={plan.childSavings.name} onChange={value => edit(draft => { if (draft.childSavings) draft.childSavings.name = value; })} />
            <label className="block text-xs font-semibold text-muted-foreground">Balances as of<input aria-label="Child balances as of" type="date" className={`${INPUT} mt-1`} value={plan.childSavings.balanceDate} onChange={event => edit(draft => { if (draft.childSavings) draft.childSavings.balanceDate = event.target.value; })} /></label>
            <NumberField label="Child JISA balance" value={plan.childSavings.jisa} onChange={value => edit(draft => { if (draft.childSavings) draft.childSavings.jisa = value; })} />
            <NumberField label="Child uni fund balance" value={plan.childSavings.universityFund} onChange={value => edit(draft => { if (draft.childSavings) draft.childSavings.universityFund = value; })} />
            <div className="flex items-center gap-3"><p className="text-xs text-muted-foreground">Total saved <strong className="block text-lg tabular-nums text-foreground">{Number.isFinite(plan.childSavings.jisa + plan.childSavings.universityFund) ? money(plan.childSavings.jisa + plan.childSavings.universityFund) : '—'}</strong></p><Button className="h-8 px-3" disabled={!valid || !dirty || saving || importing} onClick={save}>{saving ? 'Saving…' : 'Save child savings'}</Button></div>
          </div> : <Button className="mt-2 h-8 px-3" variant="outline" onClick={() => edit(draft => { draft.childSavings = { name: 'Child', balanceDate: today, jisa: 0, universityFund: 0 }; })}>Add child savings</Button>}
        </section>

        <details className={CARD}><summary className="cursor-pointer font-display text-xl font-bold">Projection settings</summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <NumberField label="Your minimum end age" value={plan.endAge} onChange={value => edit(draft => { draft.endAge = value; })} />
            <NumberField label="Youngest adult planning age" value={plan.longevityAge ?? Math.min(...plan.people.filter((_, i) => i === 0 || plan.partnerEnabled).map(person => person.age)) + plan.endAge - plan.people[0].age} onChange={value => edit(draft => { draft.longevityAge = value; })} />
          </div>
        </details>

        <PensionLinks plan={plan} onChange={links => edit(draft => { draft.pensionLinks = links; })} source={pension.source} loading={pension.loading} error={pension.error} loadedAt={pension.loadedAt} onRefresh={() => void pension.refresh()} />
        {projectionError && <p role="alert" className="rounded-tile bg-destructive/10 p-4">Projection unavailable: {projectionError} For missing history, update your balance date and balances, or link from a later year.</p>}

        <details className={CARD}><summary className="cursor-pointer font-display text-xl font-bold">Advanced assumptions</summary>
          <p className="mt-3 text-sm text-muted-foreground">These assumptions drive the forecast. Fees include management and underlying fund charges; confirm them against your provider. Gross returns are converted to today’s pounds using compounded fees and inflation. Tiered fees follow each pot’s projected nominal value; past charges are already reflected in the opening balance. Existing net-return overrides are used as entered.</p>
          <div className="mt-2 max-w-xs"><NumberField label="Long-term inflation" value={plan.inflation ?? DEFAULT_INFLATION} percent onChange={value => edit(draft => { draft.inflation = value; })} /></div>
          {plan.people.map((person, index) => (index === 0 || plan.partnerEnabled) && <div key={index} className="mt-3 border-t border-border pt-4">
            <h3 className="font-semibold">{index === 0 ? 'You' : 'Partner'}</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <NumberField label={`${index === 0 ? 'You' : 'Partner'} pension access age`} value={person.pensionAccessAge} onChange={value => edit(draft => { draft.people[index].pensionAccessAge = value; })} />
              <NumberField label={`${index === 0 ? 'You' : 'Partner'} remaining tax-free allowance`} value={person.taxFreeAllowance} onChange={value => edit(draft => { draft.people[index].taxFreeAllowance = value; })} />
            </div>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">{(['pension', 'isa'] as const).map(key => <div key={key} className="space-y-2 rounded-tile bg-cloud p-3"><NumberField label={`${index === 0 ? 'You' : 'Partner'} ${key} annual fees`} percent value={person.assets[key].feeSchedule ? assetFee(person.assets[key]) : person.assets[key].annualFee ?? 0.005} onChange={value => edit(draft => {
              const asset = draft.people[index].assets[key];
              if (!asset.grossReturns) asset.grossReturns = Object.fromEntries(RETIREMENT_CASES.map(scenario => [scenario, (1 + asset.returns[scenario]) * (1 + (draft.inflation ?? DEFAULT_INFLATION)) / (1 - (asset.annualFee ?? 0.005)) - 1])) as typeof asset.returns;
              asset.annualFee = value; delete asset.feeSchedule; asset.feesConfirmed = false;
            })} />{person.assets[key].feeSchedule && <p className="text-xs text-muted-foreground">Tiered management fee: {(person.assets[key].feeSchedule!.below * 100).toFixed(2)}% on the first {money(person.assets[key].feeSchedule!.threshold)}, {(person.assets[key].feeSchedule!.above * 100).toFixed(2)}% above it, plus {(person.assets[key].feeSchedule!.fundCost * 100).toFixed(2)}% fund costs and {(person.assets[key].feeSchedule!.marketSpread * 100).toFixed(2)}% spread. The rate above is today’s combined rate; editing it replaces the tiers with a flat rate.</p>}<label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`${index === 0 ? 'You' : 'Partner'} ${key} fees confirmed`} checked={person.assets[key].feesConfirmed ?? false} onChange={event => edit(draft => { draft.people[index].assets[key].feesConfirmed = event.target.checked; })} />Checked against provider</label></div>)}</div>
            <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><caption className="sr-only">{index === 0 ? 'Your' : 'Partner'} return assumptions</caption>
              <thead><tr className="border-b border-border">{['Asset', 'Contribution growth (%)', 'Cautious return (%)', 'Base return (%)', 'Optimistic return (%)'].map(label => <th key={label} scope="col" className="p-2 text-xs text-muted-foreground">{label}</th>)}</tr></thead>
              <tbody>{RETIREMENT_ASSETS.map(key => <tr key={key} className="border-b border-border last:border-0"><th scope="row" className="p-2 font-semibold">{ASSET_LABEL[key]}</th>
                <td className="p-2"><NumberField compact label={`${index === 0 ? 'You' : 'Partner'} ${key} contribution growth`} value={person.assets[key].contributionGrowth} percent onChange={value => edit(draft => { draft.people[index].assets[key].contributionGrowth = value; })} /></td>
                {RETIREMENT_CASES.map(scenario => <td key={scenario} className="p-2"><NumberField compact label={`${index === 0 ? 'You' : 'Partner'} ${key} ${scenario} return`} value={assetReturn(person.assets[key], scenario, plan.inflation ?? DEFAULT_INFLATION)} percent onChange={value => edit(draft => { const asset = draft.people[index].assets[key]; asset.returns[scenario] = value; if (asset.grossReturns) asset.grossReturns[scenario] = (1 + value) * (1 + (draft.inflation ?? DEFAULT_INFLATION)) / (1 - assetFee(asset)) - 1; })} /></td>)}
              </tr>)}</tbody>
            </table></div>
          </div>)}
        </details>

        <section className={CARD}><div className="flex items-center justify-between gap-3"><h2 className="font-display text-xl font-bold">Regular income</h2><Button variant="outline" onClick={() => edit(draft => { draft.income.push({ id: rowId(), label: 'New income', person: 0, startAge: draft.people[0].retirementAge, endAge: 120, annualAmount: 0, taxable: true }); })}>Add income</Button></div>
          <p className="mt-2 text-sm text-muted-foreground">Gross annual amounts; age limits apply to the person receiving the income, including both end ages.</p>
          <div className="mt-2 space-y-4">{plan.income.map((row, index) => <div key={row.id} className="grid items-end gap-3 rounded-tile bg-cloud p-3 sm:grid-cols-2 xl:grid-cols-7">
            <TextField label={`Income ${index + 1} label`} value={row.label} onChange={value => edit(draft => { draft.income[index].label = value; })} />
            <label className="text-xs font-semibold text-muted-foreground">Person<select aria-label={`Income ${index + 1} person`} className={`${INPUT} mt-1`} value={row.person} onChange={event => edit(draft => { draft.income[index].person = Number(event.target.value) as 0 | 1; })}><option value={0}>You</option><option value={1}>{plan.partnerEnabled ? 'Partner' : 'Partner (ignored)'}</option></select></label>
            <NumberField label={`Income ${index + 1} start age`} value={row.startAge} onChange={value => edit(draft => { draft.income[index].startAge = value; })} />
            <NumberField label={`Income ${index + 1} end age`} value={row.endAge} onChange={value => edit(draft => { draft.income[index].endAge = value; })} />
            <NumberField label={`Income ${index + 1} annual amount`} value={row.annualAmount} onChange={value => edit(draft => { draft.income[index].annualAmount = value; })} />
            <div className="space-y-2"><label className="block text-xs font-semibold text-muted-foreground">Income type<select aria-label={`Income ${index + 1} type`} className={`${INPUT} mt-1`} value={row.kind ?? 'other'} onChange={event => edit(draft => { draft.income[index].kind = event.target.value as typeof row.kind; draft.income[index].confirmed = false; if (event.target.value === 'state-pension') draft.income[index].taxable = true; })}><option value="other">Other income</option><option value="employment">Work</option><option value="state-pension">State Pension</option></select></label><label className="flex min-h-10 items-center gap-2 text-sm"><input aria-label={`Income ${index + 1} taxable`} disabled={row.kind === 'state-pension'} type="checkbox" checked={row.taxable} onChange={event => edit(draft => { draft.income[index].taxable = event.target.checked; })} />Taxable</label>{row.kind === 'state-pension' && <><label className="flex items-center gap-2 text-xs"><input type="checkbox" aria-label={`Income ${index + 1} entitlement confirmed`} checked={row.confirmed ?? false} onChange={event => edit(draft => { draft.income[index].confirmed = event.target.checked; })} />Amount checked against GOV.UK forecast</label><p className="text-xs text-muted-foreground">Full 2026/27 rate: {money(FULL_STATE_PENSION_2026)}/year. Your entitlement may differ. <a href="https://www.gov.uk/check-state-pension" className="underline" target="_blank" rel="noreferrer">Check forecast</a></p></>}</div>
            <Button variant="ghost" aria-label={`Remove income ${index + 1}`} onClick={() => edit(draft => { draft.income.splice(index, 1); })}>Remove</Button>
          </div>)}</div>
        </section>

        <section className={CARD}><div className="flex items-center justify-between gap-3"><h2 className="font-display text-xl font-bold">Household spending</h2><Button variant="outline" onClick={() => edit(draft => { draft.spending.push({ id: rowId(), label: 'New spending', startAge: draft.people[0].retirementAge, endAge: draft.endAge, annualAmount: 0 }); })}>Add spending</Button></div>
          <p className="mt-2 text-sm text-muted-foreground">Annual household amounts; age limits refer to your age.</p>
          <div className="mt-2 space-y-4">{plan.spending.map((row, index) => <div key={row.id} className="grid items-end gap-3 rounded-tile bg-cloud p-3 sm:grid-cols-2 xl:grid-cols-5">
            <TextField label={`Spending ${index + 1} label`} value={row.label} onChange={value => edit(draft => { draft.spending[index].label = value; })} />
            <NumberField label={`Spending ${index + 1} start age`} value={row.startAge} onChange={value => edit(draft => { draft.spending[index].startAge = value; })} />
            <NumberField label={`Spending ${index + 1} end age`} value={row.endAge} onChange={value => edit(draft => { draft.spending[index].endAge = value; })} />
            <NumberField label={`Spending ${index + 1} annual amount`} value={row.annualAmount} onChange={value => edit(draft => { draft.spending[index].annualAmount = value; })} />
            <Button variant="ghost" aria-label={`Remove spending ${index + 1}`} onClick={() => edit(draft => { draft.spending.splice(index, 1); })}>Remove</Button>
          </div>)}</div>
        </section>

        <section className={CARD}><div className="flex items-center justify-between gap-3"><h2 className="font-display text-xl font-bold">One-offs</h2><Button variant="outline" onClick={() => edit(draft => { draft.oneOffs.push({ id: rowId(), label: 'New one-off', person: 0, asset: 'cash', year: draft.startYear, amount: 0 }); })}>Add one-off</Button></div>
          <p className="mt-2 text-sm text-muted-foreground">Positive amounts deposit into a bucket; negative amounts leave the portfolio. A transfer needs a matching deposit. Pension withdrawals require access age and may create additional tax.</p>
          <div className="mt-2 space-y-4">{plan.oneOffs.map((row, index) => <div key={row.id} className="grid items-end gap-3 rounded-tile bg-cloud p-3 sm:grid-cols-2 xl:grid-cols-6">
            <TextField label={`One-off ${index + 1} label`} value={row.label} onChange={value => edit(draft => { draft.oneOffs[index].label = value; })} />
            <label className="text-xs font-semibold text-muted-foreground">Person<select aria-label={`One-off ${index + 1} person`} className={`${INPUT} mt-1`} value={row.person} onChange={event => edit(draft => { draft.oneOffs[index].person = Number(event.target.value) as 0 | 1; })}><option value={0}>You</option><option value={1}>{plan.partnerEnabled ? 'Partner' : 'Partner (ignored)'}</option></select></label>
            <label className="text-xs font-semibold text-muted-foreground">Asset<select aria-label={`One-off ${index + 1} asset`} className={`${INPUT} mt-1`} value={row.asset} onChange={event => edit(draft => { draft.oneOffs[index].asset = event.target.value as typeof row.asset; })}>{RETIREMENT_ASSETS.map(key => <option key={key} value={key}>{ASSET_LABEL[key]}</option>)}</select></label>
            <NumberField label={`One-off ${index + 1} year`} value={row.year} onChange={value => edit(draft => { draft.oneOffs[index].year = value; })} />
            <NumberField label={`One-off ${index + 1} amount`} value={row.amount} onChange={value => edit(draft => { draft.oneOffs[index].amount = value; })} />
            <Button variant="ghost" aria-label={`Remove one-off ${index + 1}`} onClick={() => edit(draft => { draft.oneOffs.splice(index, 1); })}>Remove</Button>
          </div>)}</div>
        </section>



        <details className={CARD}><summary className="cursor-pointer font-display text-xl font-bold">How this projection works</summary><div className="mt-3 space-y-3 text-sm text-muted-foreground">
          <p>Amounts are in today’s pounds. Gross return assumptions compound with fees and inflation; legacy real-return inputs are already net and are not reduced again. The first year runs only from the balance date: returns, manual contributions, regular income, tax and spending are apportioned over the remaining days. Linked pension payments resume from the next month for a mid-month balance, or the same month on its first day. Keep only future one-offs in the starting year. Opening balances grow before contributions, dated one-offs and household drawdown; results show year-end balances. Regular contributions are externally funded savings and stop at each person’s retirement age.</p>
          <p>The household pools income and assets. Drawdown uses cash and investments, then pension income within unused tax allowances, then ISAs and further pension withdrawals using the lowest available marginal tax bands across both people. Unmet needs become a visible annual shortfall; balances never go below zero. Only the pension cost accounts you explicitly link feed pension contributions. Company cash balances are never added to personal assets.</p>
          <p>Income tax uses nominal England, Wales and Northern Ireland bands for the tax year beginning in each labelled calendar year. Personal allowances and the basic-rate limit stay frozen through 2030/31, then are assumed to grow with CPI. The £100,000 taper, additional-rate threshold and remaining pension tax-free allowance stay nominal. Tax results are converted back to balance-date pounds. This annual model is not a PAYE calculation and does not track tax already paid earlier in the starting year. Income rows are gross. Pension drawdown is taxed in its withdrawal year, with up to 25% tax-free subject to the person’s remaining allowance. The example’s access age of 57 and remaining allowance of £268,275 are editable; check any protection or allowance already used.</p>
          <p>This model does not calculate National Insurance, capital gains tax, dividend tax, ISA contribution limits or property liquidation. Return cases are illustrations and do not estimate the probability of an outcome.</p>
          <p className="flex flex-wrap gap-x-5 gap-y-2"><a className="font-semibold text-aubergine underline" href="https://www.gov.uk/income-tax-rates" target="_blank" rel="noreferrer">Income tax rates</a><a className="font-semibold text-aubergine underline" href="https://www.gov.uk/tax-on-your-private-pension/lump-sum-allowance" target="_blank" rel="noreferrer">Pension tax-free allowance</a><a className="font-semibold text-aubergine underline" href="https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm028000" target="_blank" rel="noreferrer">Pension access age guidance</a></p>
        </div></details>
      </fieldset>}
    </div>
  </main>;
}
