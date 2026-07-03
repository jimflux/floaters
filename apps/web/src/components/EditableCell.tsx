import { useState, useRef, useEffect } from 'react';
import type { CashflowData, CashflowAccount } from '@/lib/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { setProjectionOverride, removeProjectionOverride, type ProjectionOverrideEntry } from '@/lib/api';

function formatGBP(n: number): string {
  const abs = Math.abs(Math.round(n));
  const formatted = abs.toLocaleString('en-GB');
  return n < 0 ? `-£${formatted}` : `£${formatted}`;
}

interface EditableCellProps {
  value: number;
  accountCode: string;
  month: string;
  isProjected: boolean;
  hasOverride: boolean;
  isCurrentMonth: boolean;
  isAltRow?: boolean;
  previousValue?: number;
  months: string[];
  monthIndex: number;
  // The stored override amount. The displayed value can be a blend (current
  // month: cash-to-date + remainder), so editing must seed from the raw
  // override or an open-then-save would silently ratchet it up.
  overrideAmount?: number;
  as?: 'td' | 'div';
}

export default function EditableCell({
  value, accountCode, month, isProjected, hasOverride, isCurrentMonth, isAltRow = false, previousValue, months, monthIndex, overrideAmount, as = 'td',
}: EditableCellProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const seed = hasOverride && overrideAmount !== undefined ? overrideAmount : value;
      setInputValue(String(Math.round(seed)));
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [open, value, hasOverride, overrideAmount]);

  // Optimistically apply override amounts to specific month indices for this
  // account, returning a snapshot so onError can roll back. The canonical
  // react-query pattern: patch in onMutate (before the request), invalidate in
  // onSettled. This makes the edit appear instantly and survive the refetch,
  // instead of flickering back when a slow/stale refetch lands.
  // The raw overrides cache gets the same treatment: it seeds the editor, so
  // leaving it stale would pre-fill the pre-edit amount if the cell is
  // reopened before the save round-trip settles.
  type MonthPatch = { index: number; month: string; amount: number };
  type OverridesCache = { overrides: ProjectionOverrideEntry[] };
  type Snapshot = { previous?: CashflowData; previousOverrides?: OverridesCache };
  const applyOptimisticOverride = async (patches: MonthPatch[]): Promise<Snapshot> => {
    await queryClient.cancelQueries({ queryKey: ['cashflow'] });
    await queryClient.cancelQueries({ queryKey: ['projection-overrides'] });
    const previous = queryClient.getQueryData<CashflowData>(['cashflow']);
    const previousOverrides = queryClient.getQueryData<OverridesCache>(['projection-overrides']);
    queryClient.setQueryData<CashflowData>(['cashflow'], (old) => {
      if (!old) return old;
      const patchAccounts = (accounts: CashflowAccount[]) =>
        accounts.map(a => {
          if (a.accountCode !== accountCode) return a;
          const monthly = [...a.monthly];
          const hasOverride = [...(a.hasOverride || a.monthly.map(() => false))];
          for (const { index, amount } of patches) {
            if (index >= 0 && index < monthly.length) {
              monthly[index] = amount;
              hasOverride[index] = true;
            }
          }
          return { ...a, monthly, hasOverride };
        });
      return { ...old, cashIn: patchAccounts(old.cashIn), cashOut: patchAccounts(old.cashOut) };
    });
    queryClient.setQueryData<OverridesCache>(['projection-overrides'], (old) => {
      if (!old) return old;
      const overrides = [...old.overrides];
      for (const { month: patchMonth, amount } of patches) {
        const i = overrides.findIndex(o => o.accountCode === accountCode && o.month === patchMonth);
        if (i >= 0) overrides[i] = { ...overrides[i], amount };
        else overrides.push({ accountCode, month: patchMonth, amount });
      }
      return { ...old, overrides };
    });
    return { previous, previousOverrides };
  };

  const rollback = (ctx: Snapshot | undefined) => {
    if (ctx?.previous) queryClient.setQueryData(['cashflow'], ctx.previous);
    if (ctx?.previousOverrides) queryClient.setQueryData(['projection-overrides'], ctx.previousOverrides);
  };

  const settle = () => {
    queryClient.invalidateQueries({ queryKey: ['cashflow'] });
    queryClient.invalidateQueries({ queryKey: ['projection-overrides'] });
  };

  const saveMutation = useMutation({
    mutationFn: (amount: number) => setProjectionOverride(accountCode, month, amount),
    onMutate: (amount: number) => {
      const monthIdx = queryClient.getQueryData<CashflowData>(['cashflow'])?.months.indexOf(month) ?? -1;
      setOpen(false);
      return applyOptimisticOverride([{ index: monthIdx, month, amount }]);
    },
    onError: (_e, _v, ctx) => { rollback(ctx); toast.error('Failed to save override'); },
    onSuccess: () => toast.success('Override saved'),
    onSettled: settle,
  });

  const fillForwardMutation = useMutation({
    mutationFn: (amount: number) => Promise.all(
      months.slice(monthIndex).map(targetMonth => setProjectionOverride(accountCode, targetMonth, amount))
    ),
    onMutate: (amount: number) => {
      const cacheMonths = queryClient.getQueryData<CashflowData>(['cashflow'])?.months ?? months;
      const patches: MonthPatch[] = [];
      for (let i = monthIndex; i < cacheMonths.length; i += 1) patches.push({ index: i, month: cacheMonths[i], amount });
      setOpen(false);
      return applyOptimisticOverride(patches);
    },
    onError: (_e, _v, ctx) => { rollback(ctx); toast.error('Failed to copy across months'); },
    onSuccess: () => toast.success('Copied across future months'),
    onSettled: settle,
  });

  // Reset reverts to the server's auto-projection (3-month average / invoice-only),
  // which we can't compute client-side, so the cell value just refetches on
  // settle. The raw override entry is removed optimistically, though, so a
  // reopened editor doesn't seed from the deleted override.
  const resetMutation = useMutation({
    mutationFn: () => removeProjectionOverride(accountCode, month),
    onMutate: async (): Promise<Snapshot> => {
      setOpen(false);
      await queryClient.cancelQueries({ queryKey: ['projection-overrides'] });
      const previousOverrides = queryClient.getQueryData<OverridesCache>(['projection-overrides']);
      queryClient.setQueryData<OverridesCache>(['projection-overrides'], (old) => {
        if (!old) return old;
        return { ...old, overrides: old.overrides.filter(o => !(o.accountCode === accountCode && o.month === month)) };
      });
      return { previousOverrides };
    },
    onError: (_e, _v, ctx) => { rollback(ctx); toast.error('Failed to remove override'); },
    onSuccess: () => toast.success('Override removed'),
    onSettled: settle,
  });

  const handleSave = () => {
    const num = parseFloat(inputValue);
    if (isNaN(num)) return;
    saveMutation.mutate(num);
  };

  const handleFillForward = () => {
    if (previousValue === undefined) return;
    const amount = Math.round(previousValue);
    setInputValue(String(amount));
    fillForwardMutation.mutate(amount);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') setOpen(false);
  };

  // Non-projected cell — not editable
  if (!isProjected && !isCurrentMonth) {
    const cls = `text-right text-xs tabular-nums ${value < 0 ? 'text-destructive' : ''} ${isCurrentMonth ? 'bg-col-highlight' : ''}`;
    if (as === 'div') return <div className={cls}>{formatGBP(value)}</div>;
    return <td className={`px-3 py-1.5 ${cls}`}>{formatGBP(value)}</td>;
  }

  // Projected cell — editable
  const baseClasses = [
    'text-right text-xs tabular-nums cursor-pointer hover:bg-accent/50 transition-colors',
    hasOverride ? 'text-blue-600 font-medium' : 'text-muted-foreground italic',
    value < 0 ? '!text-destructive' : '',
    isCurrentMonth ? 'bg-col-highlight' : '',
  ].join(' ');
  const cellClasses = as === 'td' ? `px-3 py-1.5 ${baseClasses}` : baseClasses;

  const inner = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1 w-full justify-end text-inherit font-inherit">
          {formatGBP(value)}
          {hasOverride && <Pencil className="h-2.5 w-2.5 shrink-0 opacity-60" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-3 space-y-2" align="end" sideOffset={4}>
        <p className="text-xs text-muted-foreground font-medium">Edit projection</p>
        <Input
          ref={inputRef}
          type="number"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          className="h-8 text-sm"
        />
        {previousValue !== undefined && (
          <div className="space-y-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs w-full"
              onClick={() => setInputValue(String(Math.round(previousValue)))}
            >
              Copy previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs w-full"
              onClick={handleFillForward}
              disabled={fillForwardMutation.isPending}
            >
              Copy previous across
            </Button>
          </div>
        )}
        <div className="flex gap-1.5">
          <Button
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={handleSave}
            disabled={saveMutation.isPending}
          >
            Save
          </Button>
          {hasOverride && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              title="Reset to auto-projection"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );

  if (as === 'div') return <div className={cellClasses}>{inner}</div>;
  return <td className={cellClasses}>{inner}</td>;
}