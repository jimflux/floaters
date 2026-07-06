import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import type { IncomeSection as IncomeSectionData, PipelineResponse } from '@/lib/types';

function formatGBP(n: number): string {
  const abs = Math.abs(Math.round(n));
  const formatted = abs.toLocaleString('en-GB');
  return n < 0 ? `-£${formatted}` : `£${formatted}`;
}

// Join the pipeline's unreviewed invoices to client-months the same way the
// route buckets the invoiced layer: expected/due month floored to current.
// PAID tray rows are cash already counted — no grid badge.
export function unreviewedByClientMonth(
  pipeline: PipelineResponse | undefined,
  currentMonth: string
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const inv of pipeline?.unreviewed ?? []) {
    if (inv.status !== 'AUTHORISED' && inv.status !== 'SUBMITTED') continue;
    const raw = inv.expectedPaymentDate || inv.dueDate;
    if (!raw) continue;
    let month = raw.slice(0, 7);
    if (month < currentMonth) month = currentMonth;
    if (!map.has(inv.clientKey)) map.set(inv.clientKey, new Set());
    map.get(inv.clientKey)!.add(month);
  }
  return map;
}

interface IncomeSectionProps {
  income: IncomeSectionData;
  months: string[];
  currentMonthIndex: number;
  open: boolean;
  onToggle: () => void;
  onAddProjection: () => void;
  unreviewed: Map<string, Set<string>>;
}

// The income half of the grid: a section header (layer-summed totals), three
// per-layer subtotal rows, then client rollup rows. Every cell is a single
// figure — layers get their own rows, never stacked inside one cell.
export default function IncomeSection({
  income,
  months,
  currentMonthIndex,
  open,
  onToggle,
  onAddProjection,
  unreviewed,
}: IncomeSectionProps) {
  const sectionTotal = (i: number) =>
    income.totals.paid[i] + income.totals.invoiced[i] + income.totals.projected[i];

  return (
    <>
      <tr
        className="border-b border-border cursor-pointer hover:bg-muted/20 border-l-section-income border-l-2"
        onClick={onToggle}
      >
        <td className="sticky left-0 z-10 bg-card px-3 py-2 text-xs font-semibold">
          <div className="flex items-center gap-1">
            {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
            <span>↗ Income</span>
            <button
              className="ml-1 p-0.5 rounded hover:bg-accent/50 transition-colors"
              onClick={e => { e.stopPropagation(); onAddProjection(); }}
              title="Add projection"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </td>
        {months.map((m, i) => {
          const total = sectionTotal(i);
          return (
            <td
              key={m}
              className={`px-3 py-2 text-right text-xs font-semibold tabular-nums ${total < 0 ? 'text-destructive' : ''} ${i === currentMonthIndex ? 'bg-col-highlight' : ''}`}
            >
              {formatGBP(total)}
            </td>
          );
        })}
      </tr>

      {open && (
        <>
          <LayerRow label="Paid" dotClass="bg-green-500" values={income.totals.paid} months={months} currentMonthIndex={currentMonthIndex} />
          <LayerRow label="Invoiced" dotClass="bg-blue-500" values={income.totals.invoiced} months={months} currentMonthIndex={currentMonthIndex} />
          <LayerRow label="Projected" dotClass="bg-amber-400" values={income.totals.projected} months={months} currentMonthIndex={currentMonthIndex} italic />

          {income.clients.length === 0 ? (
            <tr className="border-b border-border">
              <td className="sticky left-0 z-10 bg-card px-3 py-1.5 text-xs pl-7 text-muted-foreground italic" colSpan={1}>
                No income yet. Add a projection to start
              </td>
              {months.map(m => (
                <td key={m} />
              ))}
            </tr>
          ) : (
            income.clients.map((c, idx) => {
              const isAlt = idx % 2 === 1;
              const clientUnreviewed = unreviewed.get(c.clientKey);
              return (
                <tr key={c.clientKey} className={`border-b border-border hover:bg-muted/10 ${isAlt ? 'bg-row-alt' : ''}`}>
                  <td className={`sticky left-0 z-10 px-3 py-1.5 text-xs pl-7 truncate ${isAlt ? 'bg-row-alt' : 'bg-card'}`}>
                    {c.clientName}
                  </td>
                  {months.map((m, i) => {
                    const hasUnreviewed = clientUnreviewed?.has(m) ?? false;
                    const isOverdue = c.overdue[i];
                    return (
                      <td
                        key={m}
                        className={`relative px-3 py-1.5 text-right text-xs tabular-nums ${c.monthly[i] < 0 ? 'text-destructive' : ''} ${i === currentMonthIndex ? 'bg-col-highlight' : ''}`}
                        title={cellTitle(c.paid[i], c.invoiced[i], c.projected[i], isOverdue, hasUnreviewed)}
                      >
                        {c.monthly[i] !== 0 ? formatGBP(c.monthly[i]) : ''}
                        {isOverdue && (
                          <span data-testid="overdue-dot" className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-red-500" />
                        )}
                        {hasUnreviewed && (
                          <span data-testid="unreviewed-dot" className="absolute top-0.5 right-2.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })
          )}
        </>
      )}
    </>
  );
}

function cellTitle(paid: number, invoiced: number, projected: number, overdue: boolean, unreviewed: boolean): string {
  const parts: string[] = [];
  if (paid !== 0) parts.push(`Paid ${formatGBP(paid)}`);
  if (invoiced !== 0) parts.push(`Invoiced ${formatGBP(invoiced)}`);
  if (projected !== 0) parts.push(`Projected ${formatGBP(projected)}`);
  if (overdue) parts.push('Contains overdue invoice');
  if (unreviewed) parts.push('Has unreviewed invoice');
  return parts.join(' · ');
}

function LayerRow({ label, dotClass, values, months, currentMonthIndex, italic = false }: {
  label: string;
  dotClass: string;
  values: number[];
  months: string[];
  currentMonthIndex: number;
  italic?: boolean;
}) {
  return (
    <tr className="border-b border-border bg-row-summary" data-testid={`layer-${label.toLowerCase()}`}>
      <td className="sticky left-0 z-10 bg-row-summary px-3 py-1 text-xs pl-7">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
          {label}
        </span>
      </td>
      {months.map((m, i) => (
        <td
          key={m}
          className={`px-3 py-1 text-right text-xs tabular-nums text-muted-foreground ${italic ? 'italic' : ''} ${values[i] < 0 ? 'text-destructive' : ''} ${i === currentMonthIndex ? 'bg-col-highlight' : ''}`}
        >
          {values[i] !== 0 ? formatGBP(values[i]) : ''}
        </td>
      ))}
    </tr>
  );
}
