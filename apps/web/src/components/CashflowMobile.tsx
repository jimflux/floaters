import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { triggerSync, getPipeline } from '@/lib/api';
import type { CashflowData, CashflowAccount, IncomeSection, PipelineResponse } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { RefreshCw, ChevronDown, ChevronRight, ChevronLeft, ChevronRight as ChevR, LogOut, Settings, Inbox } from 'lucide-react';
import AccountManagementPanel from '@/components/AccountManagementPanel';
import PipelinePanel, { attentionCount } from '@/components/PipelinePanel';
import EditableCell from '@/components/EditableCell';
import AlignedChart from '@/components/AlignedChart';

function formatGBP(n: number): string {
  const abs = Math.abs(Math.round(n));
  const formatted = abs.toLocaleString('en-GB');
  return n < 0 ? `-£${formatted}` : `£${formatted}`;
}

function formatMonthShort(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

function formatMonthLong(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
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

interface Props {
  data: CashflowData;
  // Raw override amounts keyed accountCode|month (see CashflowPage)
  overrideAmounts?: Map<string, number>;
}

export default function CashflowMobile({ data, overrideAmounts = new Map() }: Props) {
  const queryClient = useQueryClient();
  const { currentBalance, fallsBelowZeroIn, optimisticFallsBelowZeroIn, currentMonthIndex, months, income, cashOut, committedOpening, committedClosing, committedNet, optimisticClosing, accounts = [] } = data;

  const [activeIdx, setActiveIdx] = useState(currentMonthIndex);
  const [incomeOpen, setIncomeOpen] = useState(true);
  // Client rows are collapsed by default on the small screen; the layer
  // subtotals carry the story.
  const [clientsOpen, setClientsOpen] = useState(false);
  const [costsOpen, setCostsOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);

  const { data: pipeline } = useQuery<PipelineResponse>({
    queryKey: ['pipeline'],
    queryFn: getPipeline,
  });

  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const syncMutation = useMutation({
    mutationFn: triggerSync,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
      toast.success('Sync complete');
    },
    onError: () => toast.error('Sync failed'),
  });

  const goPrev = () => setActiveIdx(i => Math.max(0, i - 1));
  const goNext = () => setActiveIdx(i => Math.min(months.length - 1, i + 1));

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null || touchStartY.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) goNext(); else goPrev();
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const month = months[activeIdx];
  const isProjected = activeIdx > currentMonthIndex;
  const isCurrent = activeIdx === currentMonthIndex;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-3 h-12 border-b border-border bg-card">
        <span className="font-semibold text-sm tracking-tight">Floaters</span>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8 w-8 p-0 relative" onClick={() => setPipelineOpen(true)} title="Income pipeline">
            <Inbox className="h-3.5 w-3.5" />
            {attentionCount(pipeline) > 0 && (
              <span className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-0.5 rounded-full bg-blue-600 text-white text-[9px] font-medium flex items-center justify-center">
                {attentionCount(pipeline)}
              </span>
            )}
          </Button>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} title="Sync">
            <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="outline" size="sm" className="h-8 w-8 p-0" onClick={() => setSettingsOpen(true)} title="Settings">
            <Settings className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => { document.cookie = 'app_unlocked=; max-age=0; path=/'; window.location.reload(); }} title="Lock">
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Stat block */}
      <div className="px-4 pt-4 pb-3 border-b border-border">
        <p className="text-xs text-muted-foreground mb-0.5">Today's balance</p>
        <p className="text-3xl font-bold tracking-tight tabular-nums">{formatGBP(currentBalance)}</p>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-xs text-muted-foreground">Drops below £0:</span>
          <span className={`text-sm font-semibold ${getZeroColor(fallsBelowZeroIn)}`}>{fallsBelowZeroIn || 'Never'}</span>
        </div>
        {optimisticFallsBelowZeroIn !== fallsBelowZeroIn && (
          <p className="text-xs text-muted-foreground mt-0.5">If projections land: {optimisticFallsBelowZeroIn || 'Never'}</p>
        )}
      </div>

      {/* Chart */}
      <div className="px-2 py-3 border-b border-border">
        <AlignedChart
          months={months}
          closingBalance={committedClosing}
          optimisticClosing={optimisticClosing}
          currentMonthIndex={currentMonthIndex}
          formatMonth={formatMonthShort}
        />
      </div>

      {/* Month pager */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border bg-card">
        <button
          onClick={goPrev}
          disabled={activeIdx === 0}
          className="h-8 w-8 flex items-center justify-center rounded hover:bg-accent/50 disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex flex-col items-center">
          <span className="text-sm font-semibold tracking-tight">{formatMonthLong(month)}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
            {isCurrent ? 'Current' : isProjected ? 'Projected' : 'Actual'}
          </span>
        </div>
        <button
          onClick={goNext}
          disabled={activeIdx === months.length - 1}
          className="h-8 w-8 flex items-center justify-center rounded hover:bg-accent/50 disabled:opacity-30"
        >
          <ChevR className="h-4 w-4" />
        </button>
      </div>

      {/* Dot indicator */}
      <div className="flex items-center justify-center gap-1 py-2 border-b border-border bg-card overflow-x-auto">
        {months.map((m, i) => (
          <button
            key={m}
            onClick={() => setActiveIdx(i)}
            className={`h-1.5 rounded-full transition-all shrink-0 ${
              i === activeIdx ? 'w-4 bg-foreground' :
              i === currentMonthIndex ? 'w-1.5 bg-foreground/60' :
              'w-1.5 bg-foreground/20'
            }`}
            aria-label={formatMonthShort(m)}
          />
        ))}
      </div>

      {/* Month detail list */}
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="pb-8">
        {/* Opening balance */}
        <SummaryRowMobile label="Opening balance" value={committedOpening[activeIdx]} />

        {/* Income: three layers, client rows collapsed beneath */}
        <SectionHeaderMobile
          label="↗ Income"
          total={incomeMonthTotal(income, activeIdx)}
          open={incomeOpen}
          onToggle={() => setIncomeOpen(!incomeOpen)}
          accent="border-l-section-income"
        />
        {incomeOpen && (
          <IncomeLayersMobile
            income={income}
            monthIndex={activeIdx}
            clientsOpen={clientsOpen}
            onToggleClients={() => setClientsOpen(!clientsOpen)}
          />
        )}

        {/* Costs */}
        <div className="h-2 bg-background" />
        <SectionHeaderMobile
          label="↘ Costs"
          total={sumMonthly(cashOut, activeIdx)}
          open={costsOpen}
          onToggle={() => setCostsOpen(!costsOpen)}
          accent="border-l-section-costs"
        />
        {costsOpen && cashOut.map((account, idx) => (
          <AccountRowMobile
            key={account.accountCode}
            account={account}
            monthIndex={activeIdx}
            months={months}
            currentMonthIndex={currentMonthIndex}
            isAlt={idx % 2 === 1}
            overrideAmounts={overrideAmounts}
          />
        ))}

        {/* Net + Ending */}
        <SummaryRowMobile label="Net cash movement" value={committedNet[activeIdx]} bold colored />
        <SummaryRowMobile label="Ending balance" value={committedClosing[activeIdx]} />
      </div>

      <AccountManagementPanel open={settingsOpen} onOpenChange={setSettingsOpen} accounts={accounts} />
      <PipelinePanel open={pipelineOpen} onOpenChange={setPipelineOpen} pipeline={pipeline} />
    </div>
  );
}

function incomeMonthTotal(income: IncomeSection, i: number): number {
  return income.totals.paid[i] + income.totals.invoiced[i] + income.totals.projected[i];
}

function IncomeLayersMobile({ income, monthIndex, clientsOpen, onToggleClients }: {
  income: IncomeSection; monthIndex: number; clientsOpen: boolean; onToggleClients: () => void;
}) {
  const layers: Array<{ label: string; dot: string; value: number; italic?: boolean }> = [
    { label: 'Paid', dot: 'bg-green-500', value: income.totals.paid[monthIndex] },
    { label: 'Invoiced', dot: 'bg-blue-500', value: income.totals.invoiced[monthIndex] },
    { label: 'Projected', dot: 'bg-amber-400', value: income.totals.projected[monthIndex], italic: true },
  ];
  const clientsWithValue = income.clients.filter(c => c.monthly[monthIndex] !== 0);
  return (
    <>
      {layers.map(l => (
        <div key={l.label} data-testid={`m-layer-${l.label.toLowerCase()}`} className="flex items-center justify-between px-4 py-2 border-b border-border bg-row-summary">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground pl-3">
            <span className={`h-1.5 w-1.5 rounded-full ${l.dot}`} />
            {l.label}
          </span>
          <span className={`text-sm tabular-nums text-muted-foreground ${l.italic ? 'italic' : ''} ${l.value < 0 ? 'text-destructive' : ''}`}>
            {formatGBP(l.value)}
          </span>
        </div>
      ))}
      <button
        onClick={onToggleClients}
        className="w-full flex items-center justify-between px-4 py-2 border-b border-border bg-card hover:bg-muted/20"
      >
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground pl-3">
          {clientsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          By client ({clientsWithValue.length})
        </span>
      </button>
      {clientsOpen && clientsWithValue.map((c, idx) => (
        <div key={c.clientKey} className={`flex items-center justify-between px-4 py-2.5 border-b border-border min-h-[44px] ${idx % 2 === 1 ? 'bg-row-alt' : ''}`}>
          <span className="text-xs pl-6 truncate pr-3 flex-1 inline-flex items-center gap-1.5">
            {c.clientName}
            {c.overdue[monthIndex] && <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" title="Contains overdue invoice" />}
          </span>
          <span className={`text-sm tabular-nums ${c.monthly[monthIndex] < 0 ? 'text-destructive' : ''}`}>
            {formatGBP(c.monthly[monthIndex])}
          </span>
        </div>
      ))}
    </>
  );
}

function SummaryRowMobile({ label, value, bold = true, colored = false }: {
  label: string; value: number; bold?: boolean; colored?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-row-summary">
      <span className={`text-xs ${bold ? 'font-semibold' : ''}`}>{label}</span>
      <span className={`text-sm tabular-nums ${bold ? 'font-semibold' : ''} ${colored && value < 0 ? 'text-destructive' : ''}`}>
        {formatGBP(value)}
      </span>
    </div>
  );
}

function SectionHeaderMobile({ label, total, open, onToggle, accent }: {
  label: string; total: number; open: boolean; onToggle: () => void; accent: string;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center justify-between px-4 py-3 border-b border-border bg-card hover:bg-muted/20 border-l-2 ${accent}`}
    >
      <div className="flex items-center gap-1.5">
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="text-xs font-semibold">{label}</span>
      </div>
      <span className={`text-sm font-semibold tabular-nums ${total < 0 ? 'text-destructive' : ''}`}>
        {formatGBP(total)}
      </span>
    </button>
  );
}

function AccountRowMobile({ account, monthIndex, months, currentMonthIndex, isAlt, overrideAmounts }: {
  account: CashflowAccount; monthIndex: number; months: string[]; currentMonthIndex: number; isAlt: boolean; overrideAmounts: Map<string, number>;
}) {
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 border-b border-border min-h-[44px] ${isAlt ? 'bg-row-alt' : ''}`}>
      <span className="text-xs pl-3 truncate pr-3 flex-1">{account.accountName}</span>
      <div className="shrink-0 min-w-[80px] text-right">
        <EditableCell
          value={account.monthly[monthIndex]}
          accountCode={account.accountCode}
          month={months[monthIndex]}
          isProjected={account.isProjected[monthIndex]}
          hasOverride={account.hasOverride?.[monthIndex] ?? false}
          isCurrentMonth={monthIndex === currentMonthIndex}
          isAltRow={isAlt}
          previousValue={monthIndex > 0 ? account.monthly[monthIndex - 1] : undefined}
          months={months}
          monthIndex={monthIndex}
          overrideAmount={overrideAmounts.get(`${account.accountCode}|${months[monthIndex]}`)}
          as="div"
        />
      </div>
    </div>
  );
}
