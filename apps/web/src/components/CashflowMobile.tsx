import { useState, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { triggerSync, getPipeline } from '@/lib/api';
import type { CashflowData, CashflowAccount, IncomeSection, PipelineResponse, TimeTrackingResponse } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { clearCachedData } from '@/lib/cache';
import { LOGOUT_PATH } from '@/lib/session';
import { RefreshCw, ChevronDown, ChevronRight, ChevronLeft, ChevronRight as ChevR, LogOut, Settings, Inbox, Clock, Lock, AlertTriangle, CheckCircle2 } from 'lucide-react';
import AccountManagementPanel from '@/components/AccountManagementPanel';
import PipelinePanel, { attentionCount } from '@/components/PipelinePanel';
import EditableCell from '@/components/EditableCell';
import AlignedChart from '@/components/AlignedChart';
import ForecastViewToggle from '@/components/ForecastViewToggle';
import TimePanel from '@/components/TimePanel';
import { formatHours, monthIndexer } from '@/lib/time';
import { useForecastView } from '@/hooks/use-forecast-view';
import { moneyTone, zeroChip, LAYER_DOT } from '@/lib/brand';
import FluxMark from '@/components/FluxMark';

const SECONDARY_STROKE_COMMITTED = 'hsl(var(--iris))';

// Icon pill for the aubergine header.
const HEADER_ICON_BUTTON = 'h-10 w-10 p-0 border-2 border-cloud/30 bg-transparent text-cloud hover:border-cloud hover:bg-transparent hover:text-cloud';
const SECONDARY_STROKE_PROJECTED = 'hsl(var(--muted-foreground))';

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

function sumMonthly(accounts: CashflowAccount[], monthIndex: number): number {
  return accounts.reduce((sum, a) => sum + (a.monthly[monthIndex] || 0), 0);
}

interface Props {
  data: CashflowData;
  // Raw override amounts keyed accountCode|month (see CashflowPage)
  overrideAmounts?: Map<string, number>;
  // Hours from BurnBar (see CashflowPage); absent hides the block.
  time?: TimeTrackingResponse;
}

export default function CashflowMobile({ data, overrideAmounts = new Map(), time }: Props) {
  const queryClient = useQueryClient();
  const { currentBalance, fallsBelowZeroIn, optimisticFallsBelowZeroIn, currentMonthIndex, months, income, cashOut, committedOpening, committedClosing, committedNet, optimisticClosing, optimisticNet, accounts = [], vatOwedNow, vatAdjustedClosing, vatProjectedBill, vatCurrentQuarter } = data;

  const [view, setView] = useForecastView();
  const projected = view === 'projected';
  const optimisticNetSeries = optimisticNet ?? committedNet;
  const primaryClosing = projected ? optimisticClosing : committedClosing;
  const primaryNet = projected ? optimisticNetSeries : committedNet;
  const primaryOpening = projected
    ? committedOpening.map((_, i) => (i === 0 ? committedOpening[0] : optimisticClosing[i - 1]))
    : committedOpening;
  const primaryFallsBelow = projected ? optimisticFallsBelowZeroIn : fallsBelowZeroIn;
  const secondaryFallsBelow = projected ? fallsBelowZeroIn : optimisticFallsBelowZeroIn;
  const secondaryFallsLabel = projected ? 'Cash only (committed)' : 'If projections land';

  const [activeIdx, setActiveIdx] = useState(currentMonthIndex);
  const [incomeOpen, setIncomeOpen] = useState(true);
  // Client rows are collapsed by default on the small screen; the layer
  // subtotals carry the story.
  const [clientsOpen, setClientsOpen] = useState(false);
  const [costsOpen, setCostsOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);

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
      queryClient.invalidateQueries({ queryKey: ['time'] });
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
      <header className="flex items-center justify-between px-4 h-16 bg-aubergine text-cloud">
        <span className="flex items-center gap-2">
          <FluxMark className="h-6 w-auto" />
          <span className="font-display font-extrabold text-[24px] leading-none tracking-[-0.05em]">Floaters</span>
        </span>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className={`relative ${HEADER_ICON_BUTTON}`} onClick={() => setPipelineOpen(true)} title="Income pipeline" aria-label="Income pipeline">
            <Inbox className="h-4 w-4" />
            {attentionCount(pipeline) > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-sun text-aubergine text-[11px] font-bold flex items-center justify-center ring-2 ring-aubergine">
                {attentionCount(pipeline)}
              </span>
            )}
          </Button>
          <Button size="sm" className="h-10 w-10 p-0" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} title="Sync" aria-label="Sync">
            <RefreshCw className={`h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="outline" size="sm" className={HEADER_ICON_BUTTON} onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">
            <Settings className="h-4 w-4" />
          </Button>
          <Button asChild variant="ghost" size="sm" className="h-10 w-10 p-0 text-muted-on-aubergine hover:bg-white/10 hover:text-cloud" title="Sign out">
            <a href={LOGOUT_PATH} onClick={clearCachedData} aria-label="Sign out">
              <LogOut className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </header>

      {/* Stat block */}
      <div className="mx-3 mt-3 rounded-card bg-card px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1">Today's balance</p>
            <p className={`font-display text-[34px] font-extrabold leading-none tracking-[-0.04em] tabular-nums ${currentBalance < 0 ? 'money-neg rounded-md px-1 -mx-1' : ''}`}>{formatGBP(currentBalance)}</p>
          </div>
          <ForecastViewToggle view={view} onChange={setView} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Drops below £0:</span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-bold ${zeroChip(primaryFallsBelow)}`}>
            {primaryFallsBelow ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
            {primaryFallsBelow || 'Never'}
          </span>
        </div>
        {secondaryFallsBelow !== primaryFallsBelow && (
          <p className="text-xs text-muted-foreground mt-1.5">{secondaryFallsLabel}: {secondaryFallsBelow || 'Never'}</p>
        )}
        {vatOwedNow != null && (
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-xs font-semibold text-muted-foreground">VAT owed:</span>
            <span className="text-sm font-bold tabular-nums">{formatGBP(vatOwedNow)}</span>
          </div>
        )}
      </div>

      {/* Chart */}
      <div className="mx-3 mt-3 rounded-card bg-card px-2 py-3 overflow-hidden">
        <AlignedChart
          months={months}
          closingBalance={primaryClosing}
          optimisticClosing={projected ? committedClosing : optimisticClosing}
          currentMonthIndex={currentMonthIndex}
          formatMonth={formatMonthShort}
          primaryLabel={projected ? 'Projected' : 'Committed'}
          secondaryLabel={secondaryFallsLabel}
          secondaryStroke={projected ? SECONDARY_STROKE_PROJECTED : SECONDARY_STROKE_COMMITTED}
          adjustedClosing={vatAdjustedClosing}
        />
      </div>

      {/* Month pager */}
      <div className="mx-3 mt-3 rounded-t-card flex items-center justify-between px-3 pt-3 pb-1.5 bg-card">
        <button
          onClick={goPrev}
          disabled={activeIdx === 0}
          aria-label="Previous month"
          className="h-10 w-10 flex items-center justify-center rounded-full bg-cloud hover:bg-aubergine hover:text-cloud disabled:opacity-30 disabled:hover:bg-cloud disabled:hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex flex-col items-center">
          <span className="font-display text-lg font-extrabold leading-tight tracking-[-0.02em]">{formatMonthLong(month)}</span>
          <span className="text-[11px] font-semibold text-muted-foreground">
            {isCurrent ? 'Current' : isProjected ? 'Projected' : 'Actual'}
          </span>
        </div>
        <button
          onClick={goNext}
          disabled={activeIdx === months.length - 1}
          aria-label="Next month"
          className="h-10 w-10 flex items-center justify-center rounded-full bg-cloud hover:bg-aubergine hover:text-cloud disabled:opacity-30 disabled:hover:bg-cloud disabled:hover:text-foreground"
        >
          <ChevR className="h-4 w-4" />
        </button>
      </div>

      {/* Dot indicator */}
      <div className="mx-3 flex items-center justify-center gap-1 pt-1 pb-3 border-b border-border bg-card overflow-x-auto">
        {months.map((m, i) => (
          <button
            key={m}
            onClick={() => setActiveIdx(i)}
            className={`h-2 rounded-full transition-all shrink-0 ${
              i === activeIdx ? 'w-5 bg-aubergine' :
              i === currentMonthIndex ? 'w-2 bg-iris' :
              'w-2 bg-aubergine/20'
            }`}
            aria-label={formatMonthShort(m)}
          />
        ))}
      </div>

      {/* Month detail list */}
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} className="mx-3 mb-8 rounded-b-card bg-card overflow-hidden pb-2">
        {/* Opening balance */}
        <SummaryRowMobile label="Opening balance" value={primaryOpening[activeIdx]} />

        {/* Income: three layers, client rows collapsed beneath */}
        <SectionHeaderMobile
          label="↗ Income"
          total={incomeMonthTotal(income, activeIdx)}
          open={incomeOpen}
          onToggle={() => setIncomeOpen(!incomeOpen)}
          accent="shadow-[inset_4px_0_0_hsl(var(--section-income))]"
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
        <div className="h-3 bg-card" />
        <SectionHeaderMobile
          label="↘ Costs"
          total={sumMonthly(cashOut, activeIdx)}
          open={costsOpen}
          onToggle={() => setCostsOpen(!costsOpen)}
          accent="shadow-[inset_4px_0_0_hsl(var(--section-costs))]"
        />
        {costsOpen && cashOut.map((account, idx) => {
          // Projected view shows issued + projected VAT in the VAT row (matches
          // the projected line); committed view keeps issued-only.
          const displayAccount = projected && account.accountCode === 'VAT_LIABILITY' && vatProjectedBill
            ? { ...account, monthly: vatProjectedBill }
            : account;
          return (
            <AccountRowMobile
              key={account.accountCode}
              account={displayAccount}
              monthIndex={activeIdx}
              months={months}
              currentMonthIndex={currentMonthIndex}
              isAlt={idx % 2 === 1}
              overrideAmounts={overrideAmounts}
            />
          );
        })}

        {/* Net + Ending */}
        <SummaryRowMobile label={projected ? 'Net cash movement (projected)' : 'Net cash movement'} value={primaryNet[activeIdx]} bold colored />
        <SummaryRowMobile label="Ending balance" value={primaryClosing[activeIdx]} />

        {time?.configured && (
          <HoursMobile time={time} month={month} open={hoursOpen} onToggle={() => setHoursOpen(!hoursOpen)} onOpenPanel={() => setTimeOpen(true)} />
        )}
      </div>

      <AccountManagementPanel open={settingsOpen} onOpenChange={setSettingsOpen} accounts={accounts} vatClients={income.clients} vatCurrentQuarter={vatCurrentQuarter} />
      <PipelinePanel open={pipelineOpen} onOpenChange={setPipelineOpen} pipeline={pipeline} />
      <TimePanel open={timeOpen} onOpenChange={setTimeOpen} time={time} />
    </div>
  );
}

// Hours for the active month: total in the header, clients beneath when open.
function HoursMobile({ time, month, open, onToggle, onOpenPanel }: {
  time: TimeTrackingResponse; month: string; open: boolean; onToggle: () => void; onOpenPanel: () => void;
}) {
  const i = monthIndexer(time)(month);
  const total = i < 0 ? 0 : time.totals.hours[i] ?? 0;
  const billable = i < 0 ? 0 : time.totals.billableHours[i] ?? 0;
  const clients = i < 0 ? [] : time.clients.filter(c => (c.hours[i] ?? 0) > 0);
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between px-4 py-3 border-y border-border bg-card shadow-[inset_4px_0_0_hsl(var(--section-hours))]" onClick={onToggle}>
        <div className="flex items-center gap-1 font-display text-sm font-extrabold">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <span>⏱ Hours</span>
          {time.running && <span className="ml-1.5 dot bg-mint animate-pulse" />}
          <button className="ml-1 h-7 w-7 inline-flex items-center justify-center rounded-full bg-cloud hover:bg-aubergine hover:text-cloud" onClick={e => { e.stopPropagation(); onOpenPanel(); }} title="Time tracking" aria-label="Time tracking">
            <Clock className="h-3 w-3" />
          </button>
        </div>
        <span className="text-sm font-bold tabular-nums">
          {formatHours(total) || '0h'}
          {billable > 0 && <span className="ml-1 font-normal text-muted-foreground">({formatHours(billable)} billable)</span>}
        </span>
      </div>
      {open && clients.map(c => (
        <div key={c.togglClientId ?? 'none'} className="flex items-center justify-between px-4 py-1.5 pl-7 border-b border-border text-xs">
          <span className={`truncate ${c.togglClientId === null ? 'text-muted-foreground italic' : ''}`}>{c.clientName}</span>
          <span className="tabular-nums">{formatHours(c.hours[i])}</span>
        </div>
      ))}
      {open && clients.length === 0 && (
        <p className="px-4 py-1.5 pl-7 text-xs text-muted-foreground italic">No hours this month.</p>
      )}
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
    { label: 'Paid', dot: LAYER_DOT.paid, value: income.totals.paid[monthIndex] },
    { label: 'Invoiced', dot: LAYER_DOT.invoiced, value: income.totals.invoiced[monthIndex] },
    { label: 'Projected', dot: LAYER_DOT.projected, value: income.totals.projected[monthIndex], italic: true },
  ];
  const clientsWithValue = income.clients.filter(c => c.monthly[monthIndex] !== 0);
  return (
    <>
      {layers.map(l => (
        <div key={l.label} data-testid={`m-layer-${l.label.toLowerCase()}`} className="flex items-center justify-between px-4 py-2 border-b border-border bg-row-summary">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground pl-3">
            <span className={`dot ${l.dot}`} />
            {l.label}
          </span>
          <span className={`text-sm tabular-nums text-muted-foreground rounded px-1 ${l.italic ? 'italic' : ''} ${moneyTone(l.value)}`}>
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
            {c.overdue[monthIndex] && <span className="dot bg-coral" title="Contains overdue invoice" />}
          </span>
          <span className={`text-sm tabular-nums rounded px-1 ${moneyTone(c.monthly[monthIndex])}`}>
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
      <span className={`text-xs ${bold ? 'font-bold' : ''}`}>{label}</span>
      <span className={`text-sm tabular-nums rounded px-1 ${bold ? 'font-bold' : ''} ${moneyTone(colored ? value : Math.min(value, 0))}`}>
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
        <span className="font-display text-sm font-extrabold">{label}</span>
      </div>
      <span className={`text-sm font-bold tabular-nums rounded px-1 ${moneyTone(total)}`}>
        {formatGBP(total)}
      </span>
    </button>
  );
}

function AccountRowMobile({ account, monthIndex, months, currentMonthIndex, isAlt, overrideAmounts }: {
  account: CashflowAccount; monthIndex: number; months: string[]; currentMonthIndex: number; isAlt: boolean; overrideAmounts: Map<string, number>;
}) {
  const readOnly = account.accountCode === 'VAT_LIABILITY';
  return (
    <div className={`flex items-center justify-between px-4 py-2.5 border-b border-border min-h-[44px] ${isAlt ? 'bg-row-alt' : ''}`}>
      <span className="text-xs pl-3 truncate pr-3 flex-1">
        {account.accountName}
        {readOnly && <span className="ml-1 inline-flex align-[-1px] text-muted-foreground" title="Calculated automatically"><Lock className="h-3 w-3" role="img" aria-label="Calculated automatically" /></span>}
      </span>
      <div className="shrink-0 min-w-[80px] text-right">
        {readOnly ? (
          <span className={`text-sm tabular-nums text-muted-foreground rounded px-1 ${moneyTone(account.monthly[monthIndex] ?? 0)}`}>
            {account.monthly[monthIndex] ? formatGBP(account.monthly[monthIndex]) : ''}
          </span>
        ) : (
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
        )}
      </div>
    </div>
  );
}
