import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  RETIREMENT_ASSETS, RETIREMENT_CASES, retirementPlanErrors,
  type RetirementCase, type RetirementPlan, type RetirementProjection,
} from '@floaters/types';
import { getRetirementPlan, saveRetirementPlan } from '@/lib/api';
import { createExampleRetirementPlan, projectRetirement } from '@/lib/retirement';
import { importRetirementJson, importRetirementWorkbook, MAX_RETIREMENT_FILE_BYTES } from '@/lib/retirement-import';
import { Button } from '@/components/ui/button';
import { SignInRequiredError, loginUrl } from '@/lib/session';

const INPUT = 'w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-iris';
const CARD = 'rounded-card bg-card p-4 shadow-sm shadow-aubergine/5 sm:p-6';
const CASE_LABEL: Record<RetirementCase, string> = { cautious: 'Cautious', base: 'Base', optimistic: 'Optimistic' };
const CASE_COLOR: Record<RetirementCase, string> = { cautious: 'hsl(var(--coral))', base: 'hsl(var(--iris-deep))', optimistic: 'hsl(var(--aubergine))' };
const ASSET_LABEL = { pension: 'Pension', isa: 'ISA', investments: 'Investments', cash: 'Cash' };
const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const money = (value: number) => currency.format(value);
const rowId = () => globalThis.crypto?.randomUUID?.() ?? `row-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function NumberField({ label, value, onChange, percent = false, compact = false }: { label: string; value: number; onChange: (value: number) => void; percent?: boolean; compact?: boolean }) {
  return <label className="block min-w-0 text-xs font-semibold text-muted-foreground"><span className={compact ? 'sr-only' : ''}>{label}</span>
    <input aria-label={label} type="number" step="any" className={`${INPUT} mt-1 font-normal tabular-nums`}
      value={Number.isFinite(value) ? (percent ? Number((value * 100).toFixed(6)) : value) : ''}
      onChange={event => onChange(event.target.value.trim() === '' ? NaN : Number(event.target.value) / (percent ? 100 : 1))} />
  </label>;
}
function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block min-w-0 text-xs font-semibold text-muted-foreground">{label}
    <input aria-label={label} className={`${INPUT} mt-1 font-normal`} value={value} onChange={event => onChange(event.target.value)} />
  </label>;
}

export default function RetirementPage() {
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
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
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
      setSelectedYear(next.startYear);
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
  const projections = useMemo(() => plan && !errors.length
    ? Object.fromEntries(RETIREMENT_CASES.map(scenario => [scenario, projectRetirement(plan, scenario)])) as Record<RetirementCase, RetirementProjection>
    : null, [plan, errors]);
  const chartData = useMemo(() => projections?.base.years.map((row, index) => ({ age: row.age,
    cautious: projections.cautious.years[index].totalAssets, base: row.totalAssets, optimistic: projections.optimistic.years[index].totalAssets })), [projections]);
  const dirty = !!plan && fingerprint !== savedFingerprint;
  const ready = !!plan && !loading && !loadError;
  const valid = ready && !errors.length;
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
  const save = async () => {
    if (!plan || !valid || saving || importing) return;
    const submitted = structuredClone(plan);
    setSaving(true); setSaveError(false); setSaveSuccess(false);
    try {
      const result = await saveRetirementPlan(submitted);
      setSavedFingerprint(JSON.stringify(submitted));
      setSavedAt(result.savedAt);
      setExample(false);
      setSaveSuccess(true);
    } catch { setSaveError(true); }
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
      setSelectedYear(result.plan.startYear);
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
    <header className="flex flex-col justify-between gap-4 bg-aubergine px-4 py-6 text-cloud sm:px-6 lg:flex-row lg:items-center">
      <div><h1 className="font-display text-3xl font-extrabold tracking-tight text-cloud">Retirement planner</h1><p className="mt-1 text-sm text-cloud/75">Today’s pounds · Your household, independent of company cash</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" className="border-cloud/40 bg-transparent text-cloud hover:bg-cloud/10 hover:text-cloud" disabled={!ready || importing || saving} onClick={() => workbookInput.current?.click()}>Import workbook</Button>
        <Button variant="outline" className="border-cloud/40 bg-transparent text-cloud hover:bg-cloud/10 hover:text-cloud" disabled={!ready || importing || saving} onClick={() => jsonInput.current?.click()}>Import JSON</Button>
        <Button variant="outline" className="border-cloud/40 bg-transparent text-cloud hover:bg-cloud/10 hover:text-cloud" disabled={!valid || importing} onClick={exportJson}>Export JSON</Button>
        <Button disabled={!valid || saving || importing} onClick={save}>{saving ? 'Saving…' : 'Save plan'}</Button>
      </div>
    </header>
    <input ref={workbookInput} type="file" accept=".xlsx" aria-label="Workbook file" className="hidden" disabled={!ready || importing || saving} onChange={event => void importFile(event, 'workbook')} />
    <input ref={jsonInput} type="file" accept=".json,application/json" aria-label="JSON plan file" className="hidden" disabled={!ready || importing || saving} onChange={event => void importFile(event, 'json')} />
    <div className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-6">
      {loading && <p role="status">Loading your retirement plan…</p>}
      {loadError && <div role="alert" className={`${CARD} space-y-3`}><p>Could not load your saved plan. Retry before importing or saving.</p>
        {signInRequired && <a href={loginUrl()} className="font-semibold underline">Sign in</a>}
        <Button onClick={() => setLoadAttempt(value => value + 1)}>Retry loading</Button></div>}
      {ready && plan && <>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="font-semibold">{dirty ? 'Unsaved changes' : 'Saved'}{savedAt && <span className="ml-2 font-normal text-muted-foreground">{new Date(savedAt).toLocaleString('en-GB')}</span>}</p>
          <p className="text-muted-foreground">Imports stay on this device until you choose Save plan.</p>
        </div>
        {example && <p className="rounded-tile bg-sun/20 p-4 text-sm">Example plan — invented values for illustration. Edit or import your own inputs; this example is unsaved.</p>}
        {saving && <p role="status">Saving your submitted plan… You can keep editing.</p>}
        {saveSuccess && <p role="status">{dirty ? 'Saved snapshot. Your later edits are still unsaved changes.' : 'Plan saved.'}</p>}
        {saveError && <p role="alert" className="rounded-tile bg-destructive/10 p-3">Could not save your plan. Your draft is preserved; choose Save plan to retry.</p>}
        {importing && <p role="status">Importing file…</p>}
        {importError && <p role="alert" className="rounded-tile bg-destructive/10 p-3">{importError}</p>}
        {!!warnings.length && <div className="rounded-tile bg-sun/20 p-4"><h2 className="font-semibold">Review imported inputs</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
        {!!errors.length && <div role="alert" className="rounded-tile bg-destructive/10 p-4"><h2 className="font-semibold">Check these inputs before projecting or saving</h2><ul className="mt-2 list-disc pl-5 text-sm">{errors.map((error, index) => <li key={index}>{error}</li>)}</ul></div>}

        <section className={CARD} aria-labelledby="plan-inputs"><h2 id="plan-inputs" className="font-display text-xl font-bold">Plan settings</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <NumberField label="Baseline year" value={plan.startYear} onChange={value => edit(draft => { draft.startYear = value; })} />
            <NumberField label="Project to age" value={plan.endAge} onChange={value => edit(draft => { draft.endAge = value; })} />
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={plan.partnerEnabled} onChange={event => edit(draft => { draft.partnerEnabled = event.target.checked; })} />Include partner</label>
          </div>
        </section>

        {plan.people.map((person, index) => (index === 0 || plan.partnerEnabled) && <section key={index} className={CARD}>
          <h2 className="font-display text-xl font-bold">{index === 0 ? 'You' : 'Partner'}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <TextField label={`${index === 0 ? 'You' : 'Partner'} name`} value={person.name} onChange={value => edit(draft => { draft.people[index].name = value; })} />
            {([['age', 'current age'], ['retirementAge', 'retirement age'], ['pensionAccessAge', 'pension access age'], ['taxFreeAllowance', 'remaining tax-free allowance']] as const).map(([key, label]) => <NumberField key={key} label={`${index === 0 ? 'You' : 'Partner'} ${label}`} value={person[key]} onChange={value => edit(draft => { draft.people[index][key] = value; })} />)}
          </div>
          <p className="mt-5 text-xs text-muted-foreground">Annual contributions are external savings. Return and contribution growth inputs are percentages in today’s pounds.</p>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm"><caption className="sr-only">{index === 0 ? 'Your' : 'Partner'} asset inputs</caption>
            <thead><tr className="border-b border-border">{['Asset', 'Balance (£)', 'Annual contribution (£)', 'Contribution growth (%)', 'Cautious return (%)', 'Base return (%)', 'Optimistic return (%)'].map(label => <th key={label} scope="col" className="p-2 text-xs text-muted-foreground">{label}</th>)}</tr></thead>
            <tbody>{RETIREMENT_ASSETS.map(key => <tr key={key} className="border-b border-border last:border-0"><th scope="row" className="p-2 font-semibold">{ASSET_LABEL[key]}</th>
              {(['balance', 'annualContribution', 'contributionGrowth'] as const).map(field => <td key={field} className="p-2"><NumberField compact label={`${index === 0 ? 'You' : 'Partner'} ${key} ${field === 'annualContribution' ? 'annual contribution' : field === 'contributionGrowth' ? 'contribution growth' : 'balance'}`} value={person.assets[key][field]} percent={field === 'contributionGrowth'} onChange={value => edit(draft => { draft.people[index].assets[key][field] = value; })} /></td>)}
              {RETIREMENT_CASES.map(scenario => <td key={scenario} className="p-2"><NumberField compact label={`${index === 0 ? 'You' : 'Partner'} ${key} ${scenario} return`} value={person.assets[key].returns[scenario]} percent onChange={value => edit(draft => { draft.people[index].assets[key].returns[scenario] = value; })} /></td>)}
            </tr>)}</tbody>
          </table></div>
        </section>)}

        <section className={CARD}><div className="flex items-center justify-between gap-3"><h2 className="font-display text-xl font-bold">Regular income</h2><Button variant="outline" onClick={() => edit(draft => { draft.income.push({ id: rowId(), label: 'New income', person: 0, startAge: draft.people[0].retirementAge, endAge: 120, annualAmount: 0, taxable: true }); })}>Add income</Button></div>
          <p className="mt-2 text-sm text-muted-foreground">Gross annual amounts; age limits apply to the person receiving the income, including both end ages.</p>
          <div className="mt-4 space-y-4">{plan.income.map((row, index) => <div key={row.id} className="grid items-end gap-3 rounded-tile bg-cloud p-3 sm:grid-cols-2 xl:grid-cols-7">
            <TextField label={`Income ${index + 1} label`} value={row.label} onChange={value => edit(draft => { draft.income[index].label = value; })} />
            <label className="text-xs font-semibold text-muted-foreground">Person<select aria-label={`Income ${index + 1} person`} className={`${INPUT} mt-1`} value={row.person} onChange={event => edit(draft => { draft.income[index].person = Number(event.target.value) as 0 | 1; })}><option value={0}>You</option><option value={1}>{plan.partnerEnabled ? 'Partner' : 'Partner (ignored)'}</option></select></label>
            <NumberField label={`Income ${index + 1} start age`} value={row.startAge} onChange={value => edit(draft => { draft.income[index].startAge = value; })} />
            <NumberField label={`Income ${index + 1} end age`} value={row.endAge} onChange={value => edit(draft => { draft.income[index].endAge = value; })} />
            <NumberField label={`Income ${index + 1} annual amount`} value={row.annualAmount} onChange={value => edit(draft => { draft.income[index].annualAmount = value; })} />
            <label className="flex min-h-10 items-center gap-2 text-sm"><input aria-label={`Income ${index + 1} taxable`} type="checkbox" checked={row.taxable} onChange={event => edit(draft => { draft.income[index].taxable = event.target.checked; })} />Taxable</label>
            <Button variant="ghost" aria-label={`Remove income ${index + 1}`} onClick={() => edit(draft => { draft.income.splice(index, 1); })}>Remove</Button>
          </div>)}</div>
        </section>

        <section className={CARD}><div className="flex items-center justify-between gap-3"><h2 className="font-display text-xl font-bold">Household spending</h2><Button variant="outline" onClick={() => edit(draft => { draft.spending.push({ id: rowId(), label: 'New spending', startAge: draft.people[0].retirementAge, endAge: draft.endAge, annualAmount: 0 }); })}>Add spending</Button></div>
          <p className="mt-2 text-sm text-muted-foreground">Annual household amounts; age limits refer to your age.</p>
          <div className="mt-4 space-y-4">{plan.spending.map((row, index) => <div key={row.id} className="grid items-end gap-3 rounded-tile bg-cloud p-3 sm:grid-cols-2 xl:grid-cols-5">
            <TextField label={`Spending ${index + 1} label`} value={row.label} onChange={value => edit(draft => { draft.spending[index].label = value; })} />
            <NumberField label={`Spending ${index + 1} start age`} value={row.startAge} onChange={value => edit(draft => { draft.spending[index].startAge = value; })} />
            <NumberField label={`Spending ${index + 1} end age`} value={row.endAge} onChange={value => edit(draft => { draft.spending[index].endAge = value; })} />
            <NumberField label={`Spending ${index + 1} annual amount`} value={row.annualAmount} onChange={value => edit(draft => { draft.spending[index].annualAmount = value; })} />
            <Button variant="ghost" aria-label={`Remove spending ${index + 1}`} onClick={() => edit(draft => { draft.spending.splice(index, 1); })}>Remove</Button>
          </div>)}</div>
        </section>

        <section className={CARD}><div className="flex items-center justify-between gap-3"><h2 className="font-display text-xl font-bold">One-offs</h2><Button variant="outline" onClick={() => edit(draft => { draft.oneOffs.push({ id: rowId(), label: 'New one-off', person: 0, asset: 'cash', year: draft.startYear, amount: 0 }); })}>Add one-off</Button></div>
          <p className="mt-2 text-sm text-muted-foreground">Positive amounts deposit into a bucket; negative amounts leave the portfolio. A transfer needs a matching deposit. Pension withdrawals require access age and may create additional tax.</p>
          <div className="mt-4 space-y-4">{plan.oneOffs.map((row, index) => <div key={row.id} className="grid items-end gap-3 rounded-tile bg-cloud p-3 sm:grid-cols-2 xl:grid-cols-6">
            <TextField label={`One-off ${index + 1} label`} value={row.label} onChange={value => edit(draft => { draft.oneOffs[index].label = value; })} />
            <label className="text-xs font-semibold text-muted-foreground">Person<select aria-label={`One-off ${index + 1} person`} className={`${INPUT} mt-1`} value={row.person} onChange={event => edit(draft => { draft.oneOffs[index].person = Number(event.target.value) as 0 | 1; })}><option value={0}>You</option><option value={1}>{plan.partnerEnabled ? 'Partner' : 'Partner (ignored)'}</option></select></label>
            <label className="text-xs font-semibold text-muted-foreground">Asset<select aria-label={`One-off ${index + 1} asset`} className={`${INPUT} mt-1`} value={row.asset} onChange={event => edit(draft => { draft.oneOffs[index].asset = event.target.value as typeof row.asset; })}>{RETIREMENT_ASSETS.map(key => <option key={key} value={key}>{ASSET_LABEL[key]}</option>)}</select></label>
            <NumberField label={`One-off ${index + 1} year`} value={row.year} onChange={value => edit(draft => { draft.oneOffs[index].year = value; })} />
            <NumberField label={`One-off ${index + 1} amount`} value={row.amount} onChange={value => edit(draft => { draft.oneOffs[index].amount = value; })} />
            <Button variant="ghost" aria-label={`Remove one-off ${index + 1}`} onClick={() => edit(draft => { draft.oneOffs.splice(index, 1); })}>Remove</Button>
          </div>)}</div>
        </section>

        {detail && selected && <section className={CARD} aria-labelledby="projection-results">
          <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 id="projection-results" className="font-display text-xl font-bold">Projected assets by age</h2><p className="mt-1 text-sm text-muted-foreground">Three illustrative return cases, not probabilities.</p></div>
            <label className="text-xs font-semibold text-muted-foreground">Detail case<select aria-label="Detail case" className={`${INPUT} mt-1`} value={detailCase} onChange={event => setDetailCase(event.target.value as RetirementCase)}>{RETIREMENT_CASES.map(scenario => <option key={scenario} value={scenario}>{CASE_LABEL[scenario]}</option>)}</select></label>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-tile bg-cloud p-4"><p className="text-xs font-semibold text-muted-foreground">First annual shortfall · {CASE_LABEL[detailCase]}</p><p className="mt-2 text-lg font-bold">{detail.firstShortfall ? `Age ${detail.firstShortfall.age} · ${detail.firstShortfall.year}` : `No shortfall through age ${plan.endAge}`}</p>{detail.firstShortfall && <p className="text-sm">{money(detail.firstShortfall.amount)} unmet</p>}</div>
            <div className="rounded-tile bg-cloud p-4"><p className="text-xs font-semibold text-muted-foreground">Assets at your retirement · age {plan.people[0].retirementAge}</p><p className="mt-2 text-lg font-bold">{detail.assetsAtRetirement === null ? 'Outside projection range' : money(detail.assetsAtRetirement)}</p></div>
            <div className="rounded-tile bg-cloud p-4"><p className="text-xs font-semibold text-muted-foreground">Accessible assets in {selected.year} · age {selected.age}</p><p className="mt-2 text-lg font-bold">{money(selected.accessibleAssets)}</p><p className="text-xs text-muted-foreground">Excludes pensions before each person’s access age.</p></div>
          </div>
          <div className="mt-6 h-[300px] w-full min-w-0 sm:h-[360px]" role="img" aria-label="Cautious, base and optimistic projected household assets by your age">
            <ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 10, right: 10, left: 5, bottom: 10 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="age" tickLine={false} /><YAxis width={72} tickFormatter={value => `£${Math.round(Number(value) / 1000)}k`} tickLine={false} /><Tooltip formatter={(value: unknown) => money(Number(value))} labelFormatter={value => `Age ${value}`} /><Legend formatter={value => <span className="text-foreground">{value}</span>} />{RETIREMENT_CASES.map(scenario => <Line key={scenario} type="monotone" dataKey={scenario} name={CASE_LABEL[scenario]} stroke={CASE_COLOR[scenario]} strokeWidth={2} strokeDasharray={scenario === 'cautious' ? '5 4' : scenario === 'optimistic' ? '2 4' : undefined} dot={false} isAnimationActive={false} />)}</LineChart></ResponsiveContainer>
          </div>
          <div className="mt-5 flex flex-wrap items-end justify-between gap-4"><h3 className="font-display text-lg font-bold">Annual detail · {CASE_LABEL[detailCase]}</h3><label className="text-xs font-semibold text-muted-foreground">Selected year<select aria-label="Selected year" className={`${INPUT} mt-1`} value={selected.year} onChange={event => setSelectedYear(Number(event.target.value))}>{detail.years.map(row => <option key={row.year} value={row.year}>{row.year} · age {row.age}</option>)}</select></label></div>
          <p className="mt-2 text-xs text-muted-foreground">Year-end balances. Withdrawals fund spending and tax; separate one-off outflows are already deducted from their buckets. Shortfall includes unmet spending and blocked or insufficient one-offs.</p>
          <div className="mt-3 max-h-[560px] overflow-auto"><table className="w-full min-w-[1400px] text-right text-xs tabular-nums"><caption className="sr-only">Annual retirement projection in today’s pounds</caption><thead className="sticky top-0 bg-card"><tr>{['Year', 'Your age', 'Partner age', 'Total assets', 'Accessible', 'Pension', 'ISA', 'Investments', 'Cash', 'Contributions', 'Gross income', 'Spending', 'Tax', 'Withdrawals', 'Shortfall'].map(label => <th key={label} scope="col" className="whitespace-nowrap border-b border-border px-3 py-3 font-semibold">{label}</th>)}</tr></thead><tbody>{detail.years.map(row => <tr key={row.year} aria-selected={row.year === selected.year} className={`border-b border-border ${row.year === selected.year ? 'bg-iris/10' : ''}`}><th scope="row" className="px-3 py-2"><button className="font-semibold underline decoration-transparent hover:decoration-current" aria-label={`Select year ${row.year}`} onClick={() => setSelectedYear(row.year)}>{row.year}</button></th><td className="px-3 py-2">{row.age}</td><td className="px-3 py-2">{row.partnerAge ?? '—'}</td>{(['totalAssets', 'accessibleAssets', 'pension', 'isa', 'investments', 'cash', 'contributions', 'income', 'spending', 'tax', 'withdrawals', 'shortfall'] as const).map(key => <td key={key} className={`whitespace-nowrap px-3 py-2 ${key === 'shortfall' && row.shortfall > 0 ? 'font-bold text-foreground bg-destructive/10' : ''}`}>{money(row[key])}</td>)}</tr>)}</tbody></table></div>
        </section>}

        <section className={CARD}><h2 className="font-display text-xl font-bold">How this projection works</h2><div className="mt-3 space-y-3 text-sm text-muted-foreground">
          <p>Amounts are in today’s pounds. Annual real returns are net of fees; inflation is not deducted again. Opening balances grow before contributions, dated one-offs and household drawdown; results show year-end balances. Regular contributions are externally funded savings and stop at each person’s retirement age.</p>
          <p>The household pools income and assets. Drawdown uses cash, investments, ISA, then accessible pensions across both people. Unmet needs become a visible annual shortfall; balances never go below zero. There is no automatic link to company cash.</p>
          <p>Income tax uses England, Wales and Northern Ireland 2026/27 bands and the tapered personal allowance, held constant in today’s pounds for future years. Income rows are gross. Pension drawdown is taxed in its withdrawal year, with up to 25% tax-free subject to the person’s remaining allowance. The example’s access age of 57 and remaining allowance of £268,275 are editable; check any protection or allowance already used.</p>
          <p>This model does not calculate National Insurance, capital gains tax, dividend tax, ISA contribution limits or property liquidation. Return cases are illustrations and do not estimate the probability of an outcome.</p>
          <p className="flex flex-wrap gap-x-5 gap-y-2"><a className="font-semibold text-aubergine underline" href="https://www.gov.uk/income-tax-rates" target="_blank" rel="noreferrer">Income tax rates</a><a className="font-semibold text-aubergine underline" href="https://www.gov.uk/tax-on-your-private-pension/lump-sum-allowance" target="_blank" rel="noreferrer">Pension tax-free allowance</a><a className="font-semibold text-aubergine underline" href="https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm028000" target="_blank" rel="noreferrer">Pension access age guidance</a></p>
        </div></section>
      </>}
    </div>
  </main>;
}
