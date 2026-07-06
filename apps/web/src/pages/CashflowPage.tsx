import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getCashflow, getProjectionOverrides, triggerSync, setProjectionOverride, type ProjectionOverrideEntry } from '@/lib/api';
import type { CashflowData, CashflowAccount, CashflowAccountInfo } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { RefreshCw, ChevronDown, ChevronRight, Settings, Plus } from 'lucide-react';
import AccountManagementPanel from '@/components/AccountManagementPanel';
import EditableCell from '@/components/EditableCell';
import AlignedChart, { COL_WIDTH } from '@/components/AlignedChart';
import CashflowMobile from '@/components/CashflowMobile';
import { useIsMobile } from '@/hooks/use-mobile';

const LABEL_WIDTH = 200;

function formatGBP(n: number): string {
  const abs = Math.abs(Math.round(n));
  const formatted = abs.toLocaleString('en-GB');
  return n < 0 ? `-£${formatted}` : `£${formatted}`;
}

function formatMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

function getZeroColor(value: string | null): string {
  if (!value) return 'text-green-600';
  const lower = value.toLowerCase();
  if (lower === 'this month' || lower.includes('1 month') || lower.includes('2 month')) return 'text-red-600';
  if (lower.includes('3 month') || lower.includes('4 month') || lower.includes('5 month')) return 'text-amber-600';
  return 'text-green-600';
}

function sumMonthly(accounts: CashflowAccount[], monthIndex: number): number {
  return accounts.reduce((sum, a) => sum + (a.monthly[monthIndex] || 0), 0);
}

export default function CashflowPage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [incomeOpen, setIncomeOpen] = useState(true);
  const [costsOpen, setCostsOpen] = useState(true);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { data, isLoading, isError, error } = useQuery<CashflowData>({
    queryKey: ['cashflow'],
    queryFn: async () => {
      const result = await getCashflow();
      try { localStorage.setItem('cashflow_cache', JSON.stringify(result)); } catch { /* cache is best-effort */ }
      return result;
    },
    initialData: () => {
      try {
        const cached = localStorage.getItem('cashflow_cache');
        return cached ? JSON.parse(cached) : undefined;
      } catch { return undefined; }
    },
    initialDataUpdatedAt: 0, // always refetch in background
  });

  // Raw override amounts, keyed accountCode|month, so editing a blended cell
  // seeds from the stored override rather than the displayed value. Warm-started
  // from localStorage like the cashflow query: a cached grid paints instantly,
  // and the pre-fill protection must not lag behind it.
  const { data: overridesData } = useQuery<{ overrides: ProjectionOverrideEntry[] }>({
    queryKey: ['projection-overrides'],
    queryFn: async () => {
      const result = await getProjectionOverrides();
      try { localStorage.setItem('projection_overrides_cache', JSON.stringify(result)); } catch { /* cache is best-effort */ }
      return result;
    },
    initialData: () => {
      try {
        const cached = localStorage.getItem('projection_overrides_cache');
        return cached ? JSON.parse(cached) : undefined;
      } catch { return undefined; }
    },
    initialDataUpdatedAt: 0, // always refetch in background
  });
  const overrideAmounts = new Map<string, number>();
  for (const o of overridesData?.overrides ?? []) {
    overrideAmounts.set(`${o.accountCode}|${o.month}`, o.amount);
  }

  const syncMutation = useMutation({
    mutationFn: triggerSync,
    onSuccess: () => {
      setLastSync(new Date());
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
      toast.success('Sync complete');
    },
    onError: () => toast.error('Sync failed'),
  });

  if (isLoading) return <LoadingSkeleton />;
  if (isError) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background text-foreground">
      <p className="text-sm text-muted-foreground">Failed to load data: {(error as Error).message}</p>
      <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ['cashflow'] })}>Retry</Button>
    </div>
  );
  if (!data) return null;

  if (isMobile) return <CashflowMobile data={data} overrideAmounts={overrideAmounts} />;

  const { currentBalance, fallsBelowZeroIn, currentMonthIndex, months, cashIn, cashOut, openingBalance, closingBalance, netCashMovement, accounts = [] } = data;

  const minTotalWidth = LABEL_WIDTH + months.length * COL_WIDTH;
  const responsiveGridWidth = `max(${minTotalWidth}px, 100%)`;
  const responsiveMonthWidth = `max(${COL_WIDTH}px, calc((100% - ${LABEL_WIDTH}px) / ${months.length}))`;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-6 h-14 border-b border-border bg-card">
        <span className="font-semibold text-sm tracking-tight">Floaters</span>
        <div className="flex items-center gap-3">
          {lastSync && <span className="text-xs text-muted-foreground">Synced {formatTimeAgo(lastSync)}</span>}
          <Button variant="outline" size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
            <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
            <span className="ml-1.5">Sync Now</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} title="Account Settings">
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="px-6 py-6">
        {/* Single scroll container for chart row + table */}
        <div className="border border-border rounded-lg overflow-x-auto">
          <div style={{ width: responsiveGridWidth, minWidth: minTotalWidth }}>
            {/* Chart row: stat cards (sticky left) + chart */}
            <div className="flex border-b border-border">
              {/* Stat cards — sticky left, same width as label column */}
              <div
                className="sticky left-0 z-10 bg-card flex flex-col justify-center gap-3 px-3 py-4 border-r border-border shrink-0"
                style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH }}
              >
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Today's balance</p>
                  <p className="text-2xl font-bold tracking-tight tabular-nums">{formatGBP(currentBalance)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Drops below £0</p>
                  <p className={`text-2xl font-bold tracking-tight ${getZeroColor(fallsBelowZeroIn)}`}>
                    {fallsBelowZeroIn || 'Never'}
                  </p>
                </div>
              </div>

              {/* Chart area — scrolls with table */}
              <div className="shrink-0" style={{ width: `calc(100% - ${LABEL_WIDTH}px)` }}>
                <AlignedChart
                  months={months}
                  closingBalance={closingBalance}
                  currentMonthIndex={currentMonthIndex}
                  formatMonth={formatMonth}
                  colWidth={undefined}
                />
              </div>
            </div>

            {/* Table */}
            <table className="text-sm border-collapse" style={{ width: '100%', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH }} />
                {months.map(m => (
                  <col key={m} style={{ width: responsiveMonthWidth, minWidth: COL_WIDTH }} />
                ))}
              </colgroup>
              <thead>
                <tr className="border-b border-border">
                  <th className="sticky left-0 z-10 bg-card text-left px-3 py-2 text-xs font-medium text-muted-foreground">Account</th>
                  {months.map((m, i) => (
                    <th key={m} className={`px-3 py-2 text-right text-xs font-medium text-muted-foreground ${i === currentMonthIndex ? 'bg-col-highlight' : 'bg-card'}`}>
                      {formatMonth(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Opening balance */}
                <SummaryRow label="Opening balance" values={openingBalance} months={months} currentMonthIndex={currentMonthIndex} />

                {/* Income section */}
                <SectionHeader label="↗ Income" open={incomeOpen} onToggle={() => setIncomeOpen(!incomeOpen)} months={months} currentMonthIndex={currentMonthIndex} accounts={cashIn} allAccounts={accounts} existingCodes={cashIn.map(a => a.accountCode)} section="income" />
                {incomeOpen && cashIn.map((account, idx) => (
                  <AccountRow key={account.accountCode} account={account} months={months} currentMonthIndex={currentMonthIndex} rowIndex={idx} overrideAmounts={overrideAmounts} />
                ))}

                {/* Spacer between sections */}
                <tr><td colSpan={months.length + 1} className="h-2 border-0 bg-background" /></tr>

                {/* Costs section */}
                <SectionHeader label="↘ Costs" open={costsOpen} onToggle={() => setCostsOpen(!costsOpen)} months={months} currentMonthIndex={currentMonthIndex} accounts={cashOut} allAccounts={accounts} existingCodes={cashOut.map(a => a.accountCode)} section="costs" />
                {costsOpen && cashOut.map((account, idx) => (
                  <AccountRow key={account.accountCode} account={account} months={months} currentMonthIndex={currentMonthIndex} rowIndex={idx} overrideAmounts={overrideAmounts} />
                ))}

                {/* Net cash movement */}
                <SummaryRow label="Net cash movement" values={netCashMovement} months={months} currentMonthIndex={currentMonthIndex} bold colored />

                {/* Closing balance */}
                <SummaryRow label="Ending balance" values={closingBalance} months={months} currentMonthIndex={currentMonthIndex} />
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AccountManagementPanel open={settingsOpen} onOpenChange={setSettingsOpen} accounts={accounts} />
    </div>
  );
}

/* --- Sub-components --- */

function SummaryRow({ label, values, months, currentMonthIndex, bold = true, colored = false }: {
  label: string; values: number[]; months: string[]; currentMonthIndex: number; bold?: boolean; colored?: boolean;
}) {
  return (
    <tr className="border-b border-border bg-row-summary">
      <td className={`sticky left-0 z-10 bg-row-summary px-3 py-1.5 text-xs ${bold ? 'font-semibold' : ''}`}>{label}</td>
      {months.map((m, i) => (
        <td key={m} className={`px-3 py-1.5 text-right text-xs tabular-nums ${bold ? 'font-semibold' : ''} ${colored && values[i] < 0 ? 'text-destructive' : ''} ${i === currentMonthIndex ? 'bg-col-highlight' : ''}`}>
          {formatGBP(values[i])}
        </td>
      ))}
    </tr>
  );
}

function SectionHeader({ label, open, onToggle, months, currentMonthIndex, accounts, allAccounts, existingCodes, section }: {
  label: string; open: boolean; onToggle: () => void; months: string[]; currentMonthIndex: number;
  accounts: CashflowAccount[]; allAccounts: CashflowAccountInfo[]; existingCodes: string[]; section: 'income' | 'costs';
}) {
  const accentColor = section === 'income' ? 'border-l-section-income' : 'border-l-section-costs';
  return (
    <tr className={`border-b border-border cursor-pointer hover:bg-muted/20 ${accentColor} border-l-2`} onClick={onToggle}>
      <td className="sticky left-0 z-10 bg-card px-3 py-2 text-xs font-semibold">
        <div className="flex items-center gap-1">
          {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <span>{label}</span>
          <AddAccountButton
            section={section}
            allAccounts={allAccounts}
            existingCodes={existingCodes}
            months={months}
            currentMonthIndex={currentMonthIndex}
          />
        </div>
      </td>
      {months.map((m, i) => {
        const total = sumMonthly(accounts, i);
        return (
          <td key={m} className={`px-3 py-2 text-right text-xs font-semibold tabular-nums ${total < 0 ? 'text-destructive' : ''} ${i === currentMonthIndex ? 'bg-col-highlight' : ''}`}>
            {formatGBP(total)}
          </td>
        );
      })}
    </tr>
  );
}

function AccountRow({ account, months, currentMonthIndex, rowIndex, overrideAmounts }: {
  account: CashflowAccount; months: string[]; currentMonthIndex: number; rowIndex: number; overrideAmounts: Map<string, number>;
}) {
  const isAlt = rowIndex % 2 === 1;
  return (
    <tr className={`border-b border-border hover:bg-muted/10 ${isAlt ? 'bg-row-alt' : ''}`}>
      <td className={`sticky left-0 z-10 px-3 py-1.5 text-xs pl-7 truncate ${isAlt ? 'bg-row-alt' : 'bg-card'}`}>{account.accountName}</td>
      {months.map((m, i) => (
        <EditableCell
          key={m}
          value={account.monthly[i]}
          accountCode={account.accountCode}
          month={m}
          isProjected={account.isProjected[i]}
          hasOverride={account.hasOverride?.[i] ?? false}
          isCurrentMonth={i === currentMonthIndex}
          isAltRow={isAlt}
          previousValue={i > 0 ? account.monthly[i - 1] : undefined}
          months={months}
          monthIndex={i}
          overrideAmount={overrideAmounts.get(`${account.accountCode}|${m}`)}
        />
      ))}
    </tr>
  );
}

function AddAccountButton({ section, allAccounts, existingCodes, months, currentMonthIndex }: {
  section: 'income' | 'costs'; allAccounts: CashflowAccountInfo[]; existingCodes: string[]; months: string[]; currentMonthIndex: number;
}) {
  const queryClient = useQueryClient();
  const [listOpen, setListOpen] = useState(false);

  const available = allAccounts.filter(a => a.section === section && !existingCodes.includes(a.code) && !a.hidden);

  // Use the first future month (after current) as the seed month
  const seedMonth = months[Math.min(currentMonthIndex + 1, months.length - 1)] || months[months.length - 1];

  const addMutation = useMutation({
    mutationFn: (accountCode: string) => setProjectionOverride(accountCode, seedMonth, 0),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
      toast.success('Account added — click any projected cell to set values');
    },
    onError: () => toast.error('Failed to add account'),
  });

  if (available.length === 0) return null;

  return (
    <Popover open={listOpen} onOpenChange={setListOpen}>
      <PopoverTrigger asChild>
        <button
          className="ml-1 p-0.5 rounded hover:bg-accent/50 transition-colors"
          onClick={e => { e.stopPropagation(); }}
          title="Add account projection"
        >
          <Plus className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-2 max-h-[300px] overflow-y-auto" align="start" sideOffset={4}>
        <p className="text-xs font-medium text-muted-foreground px-2 py-1">Add account</p>
        {available.map(a => (
          <button
            key={a.code}
            className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent/50 transition-colors"
            onClick={() => { setListOpen(false); addMutation.mutate(a.code); }}
          >
            <span>{a.name}</span>
            <span className="ml-1.5 text-muted-foreground">{a.code}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-14 border-b border-border" />
      <div className="px-6 py-6 space-y-6">
        <Skeleton className="h-[240px] rounded-lg" />
        <Skeleton className="h-[400px] rounded-lg" />
      </div>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
