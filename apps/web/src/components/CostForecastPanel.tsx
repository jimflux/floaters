import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CostForecastReview, CostRule, CostSettingsChange } from '@floaters/types';
import type { CashflowAccountInfo } from '@/lib/types';
import { saveCostSetting, removeCostSetting } from '@/lib/api';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forecast?: CostForecastReview;
  accounts: CashflowAccountInfo[];
  currentMonth: string;
}
type Draft = { rule: CostRule; kind: 'suggestion' | 'existing' | 'additional' };
const money = (amount: number) => amount.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
const frequency = (rule: CostRule) => rule.endMonth === rule.startMonth ? 'Once' : ({ 1: 'Monthly', 3: 'Quarterly', 12: 'Annually' }[rule.frequencyMonths]);

export default function CostForecastPanel({ open, onOpenChange, forecast, accounts, currentMonth }: Props) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const costAccounts = accounts.filter(account => account.section === 'costs' && !account.hidden && account.code !== 'VAT_LIABILITY' && !forecast?.managedAccountCodes?.includes(account.code));
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['cashflow'] });
  };
  const save = useMutation({
    mutationFn: (change: CostSettingsChange) => saveCostSetting(change),
    onSuccess: async (_data, change) => {
      await refresh();
      if (change.type === 'recurring') setDraft(null);
      toast.success('Cost forecast updated');
    },
  });
  const remove = useMutation({ mutationFn: (change: Parameters<typeof removeCostSetting>[0]) => removeCostSetting(change), onSuccess: refresh });
  const pending = save.isPending || remove.isPending;
  const edit = (next: Draft) => { save.reset(); remove.reset(); setDraft(next); };
  const saveChange = (change: CostSettingsChange) => { remove.reset(); save.mutate(change); };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:w-[480px] sm:max-w-[480px] p-0 flex flex-col">
        <SheetHeader className="px-6 pt-6 pb-3 pr-16">
          <SheetTitle>Cost forecasts</SheetTitle>
          <SheetDescription>Review recurring payments, exclude one-offs from estimates and plan additional costs. Amounts are future cash, including VAT.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 space-y-6">
          {!forecast ? <p className="text-sm text-muted-foreground">Cost forecast details are unavailable. Refresh cashflow to load them.</p> : <>
            {(save.isError || remove.isError) && <p role="alert" className="text-sm text-destructive">Could not save your changes. Your draft is still here; please retry.</p>}
            {draft ? <RuleEditor key={draft.rule.streamKey} draft={draft} forecast={forecast} accounts={costAccounts} pending={pending} onSave={rule => saveChange({ type: 'recurring', rule })} onCancel={() => { setDraft(null); save.reset(); }} /> : <Button variant="outline" disabled={pending || costAccounts.length === 0} onClick={() => edit({ kind: 'additional', rule: { accountCode: costAccounts[0].code, streamKey: `manual:${crypto.randomUUID()}`, label: '', amount: 0, frequencyMonths: 1, startMonth: currentMonth, endMonth: null } })}>Additional planned cost</Button>}
            <section aria-label="Recurring suggestions" className="space-y-2">
              <h3 className="font-semibold text-sm">Suggestions to review</h3>
              <p className="text-xs text-muted-foreground">Suggestions are not scheduled until you confirm them. Their past payments can still contribute to the variable estimate. Choose “No longer happening” to stop estimating a cancelled cost. When descriptions change, review and match them to the same schedule.</p>
              {forecast.suggestions.length === 0 && <p className="text-sm text-muted-foreground">No recurring suggestions yet.</p>}
              {forecast.suggestions.map(rule => <div key={rule.streamKey} className="rounded-lg bg-card border p-3 space-y-2">
                <p className="text-sm font-semibold break-words">{rule.label}</p>
                <p className="text-xs">{money(rule.amount)} · {frequency(rule)} · {rule.evidenceCount} payments</p>
                <p className="text-xs text-muted-foreground">{rule.reason}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={pending} aria-label={`Review ${rule.label}`} onClick={() => edit({ kind: 'suggestion', rule })}>Review</Button>
                  <Button size="sm" variant="ghost" disabled={pending} aria-label={`No longer happening: ${rule.label}`} onClick={() => { if (draft?.rule.streamKey === rule.streamKey) setDraft(null); saveChange({ type: 'dismissed', stream: { accountCode: rule.accountCode, streamKey: rule.streamKey, label: rule.label } }); }}>No longer happening</Button>
                </div>
              </div>)}
            </section>
            {!!forecast.settings.dismissedStreams?.length && <section aria-label="Dismissed suggestions" className="space-y-2">
              <h3 className="font-semibold text-sm">Dismissed suggestions</h3>
              <p className="text-xs text-muted-foreground">Excluded from automatic estimates. Actual payments, existing bills, confirmed schedules and manual month totals still count.</p>
              {forecast.settings.dismissedStreams.map(stream => <div key={stream.streamKey} className="rounded-lg border bg-card p-3 space-y-2">
                <p className="text-sm font-semibold break-words">{stream.label}</p>
                <Button size="sm" variant="outline" disabled={pending} aria-label={`Restore suggestion for ${stream.label}`} onClick={() => { save.reset(); remove.mutate({ type: 'dismissed', streamKey: stream.streamKey }); }}>Restore suggestion</Button>
              </div>)}
            </section>}
            <section aria-label="Scheduled costs" className="space-y-2">
              <h3 className="font-semibold text-sm">Scheduled costs</h3>
              {forecast.settings.rules.length === 0 && <p className="text-sm text-muted-foreground">No confirmed schedules.</p>}
              {forecast.settings.rules.map(rule => <div key={rule.streamKey} className="rounded-lg bg-card border p-3 space-y-2">
                <p className="text-sm font-semibold break-words">{rule.label}</p>
                <p className="text-xs">{money(rule.amount)} · {frequency(rule)} · From {rule.startMonth}{rule.endMonth ? ` to ${rule.endMonth}` : ''}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={pending} aria-label={`Edit ${rule.label}`} onClick={() => edit({ kind: 'existing', rule })}>Edit</Button>
                  <Button size="sm" variant="ghost" disabled={pending} aria-label={`Remove ${rule.label}`} onClick={() => { save.reset(); remove.mutate({ type: 'recurring', streamKey: rule.streamKey }); }}>Remove schedule</Button>
                </div>
              </div>)}
            </section>
            <section aria-label="Recent payments" className="space-y-2">
              <h3 className="font-semibold text-sm">Recent payments</h3>
              <p className="text-xs text-muted-foreground">Marking a one-off keeps the payment in your actual cash history and excludes it from future estimates. Confirmed schedules are managed above.</p>
              {forecast.recentPayments.length === 0 && <p className="text-sm text-muted-foreground">No recent payments.</p>}
              {forecast.recentPayments.map(payment => {
                const oneOff = forecast.settings.oneOffIds.includes(payment.id);
                return <div key={payment.id} className="rounded-lg border bg-card p-3 space-y-2">
                  <p className="text-sm font-semibold break-words">{payment.label}</p>
                  <p className="text-xs"><span>{payment.date}</span> · {money(payment.amount)}{oneOff ? ' · One-off' : ''}</p>
                  <Button size="sm" variant="outline" disabled={pending} aria-label={oneOff ? `Undo one-off for ${payment.label}` : `Mark ${payment.label} as one-off`} onClick={() => {
                    if (oneOff) { save.reset(); remove.mutate({ type: 'one_off', transactionId: payment.id }); }
                    else saveChange({ type: 'one_off', transactionId: payment.id });
                  }}>{oneOff ? 'Undo one-off' : 'Mark as one-off'}</Button>
                </div>;
              })}
            </section>
          </>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function RuleEditor({ draft, forecast, accounts, pending, onSave, onCancel }: { draft: Draft; forecast: CostForecastReview; accounts: CashflowAccountInfo[]; pending: boolean; onSave: (rule: CostRule) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(draft.rule.label);
  const [matches, setMatches] = useState(draft.rule.matchStreamKeys ?? []);
  const claimed = new Set(forecast.settings.rules.filter(rule => rule.streamKey !== draft.rule.streamKey)
    .flatMap(rule => [rule.streamKey, ...(rule.matchStreamKeys ?? [])]));
  const [accountCode, setAccountCode] = useState(draft.rule.accountCode);
  const available = (forecast.streams ?? []).filter(stream => stream.accountCode === accountCode && stream.streamKey !== draft.rule.streamKey && !claimed.has(stream.streamKey));
  const [amount, setAmount] = useState(String(draft.rule.amount));
  const [cadence, setCadence] = useState(draft.rule.endMonth === draft.rule.startMonth ? 'once' : String(draft.rule.frequencyMonths));
  const [startMonth, setStartMonth] = useState(draft.rule.startMonth);
  const [endMonth, setEndMonth] = useState(draft.rule.endMonth ?? '');
  const validMonth = (value: string) => /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value);
  const valid = label.trim() && label.trim().length <= 200 && matches.length <= 50 && accountCode && amount.trim() !== '' && Number.isFinite(Number(amount)) && Number(amount) > 0 && Number(amount) <= 1_000_000_000 && validMonth(startMonth) && (cadence === 'once' || !endMonth || (validMonth(endMonth) && endMonth >= startMonth));
  const selectClass = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';
  return <form className="rounded-lg border bg-card p-3 space-y-3" onSubmit={event => {
    event.preventDefault();
    if (valid) onSave({ accountCode, streamKey: draft.rule.streamKey, label: label.trim(), amount: Number(amount), frequencyMonths: cadence === 'once' ? 1 : Number(cadence) as 1 | 3 | 12, startMonth, endMonth: cadence === 'once' ? startMonth : endMonth || null, ...(matches.length || draft.rule.matchStreamKeys ? { matchStreamKeys: matches } : {}) });
  }}>
    <h3 className="font-semibold text-sm">{draft.kind === 'additional' ? 'Additional planned cost' : `Schedule ${draft.rule.label}`}</h3>
    {draft.kind === 'additional' && <p className="text-xs text-muted-foreground">Adds to your existing forecast. Match imported payments below when its bill arrives, or remove the schedule. To replace a category total, edit its month cell instead.</p>}
    <label className="block text-xs space-y-1">Label<Input maxLength={200} value={label} onChange={e => setLabel(e.target.value)} disabled={pending} /></label>
    {draft.kind === 'additional' && <label className="block text-xs space-y-1">Account<select className={selectClass} value={accountCode} onChange={e => { setAccountCode(e.target.value); setMatches([]); }} disabled={pending}>{accounts.map(account => <option key={account.code} value={account.code}>{account.name}</option>)}</select></label>}
    <label className="block text-xs space-y-1">Amount (£)<Input type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} disabled={pending} /></label>
    <label className="block text-xs space-y-1">Frequency<select className={selectClass} value={cadence} onChange={e => setCadence(e.target.value)} disabled={pending}><option value="1">Monthly</option><option value="3">Quarterly</option><option value="12">Annually</option><option value="once">Once</option></select></label>
    <label className="block text-xs space-y-1">Start month<Input type="month" value={startMonth} onChange={e => setStartMonth(e.target.value)} disabled={pending} /></label>
    {cadence !== 'once' && <label className="block text-xs space-y-1">End month (optional)<Input type="month" min={startMonth} value={endMonth} onChange={e => setEndMonth(e.target.value)} disabled={pending} /></label>}
    {(available.length > 0 || matches.length > 0) && <fieldset className="space-y-2">
      <legend className="text-xs font-semibold">Match imported payments</legend>
      <p className="text-xs text-muted-foreground">Select only descriptions for this same cost. Their cash and bills will reduce this schedule instead of adding a separate estimate. Unmatched descriptions remain separate.</p>
      {available.map(stream => <label key={stream.streamKey} className="flex items-start gap-2 text-xs break-words">
        <input type="checkbox" checked={matches.includes(stream.streamKey)} disabled={pending || (matches.length >= 50 && !matches.includes(stream.streamKey))} onChange={event => setMatches(previous => event.target.checked ? [...previous, stream.streamKey] : previous.filter(key => key !== stream.streamKey))} />
        {stream.label}
      </label>)}
      {matches.filter(key => !available.some(stream => stream.streamKey === key)).map(key => <label key={key} className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked disabled={pending} onChange={() => setMatches(previous => previous.filter(value => value !== key))} />Previously matched payment (outside current history)
      </label>)}
    </fieldset>}
    <div className="flex flex-wrap gap-2"><Button size="sm" type="submit" disabled={!valid || pending}>{draft.kind === 'suggestion' ? 'Confirm recurring cost' : draft.kind === 'additional' ? 'Save planned cost' : 'Save schedule'}</Button><Button size="sm" type="button" variant="ghost" disabled={pending} onClick={onCancel}>Cancel</Button></div>
  </form>;
}
