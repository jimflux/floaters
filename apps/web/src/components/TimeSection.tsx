import { ChevronDown, ChevronRight, Clock } from 'lucide-react';
import type { TimeTrackingResponse } from '@/lib/types';
import { formatHours, monthIndexer, cellTitle } from '@/lib/time';

// Hours worked (from Toggl) as a section under the balance walk. Context, not
// cash: it shares the grid's month columns so hours sit under the money for
// the same month, but nothing here enters any total above it.

interface TimeSectionProps {
  time: TimeTrackingResponse | undefined;
  months: string[];
  currentMonthIndex: number;
  open: boolean;
  onToggle: () => void;
  onOpenPanel: () => void;
}

export default function TimeSection({ time, months, currentMonthIndex, open, onToggle, onOpenPanel }: TimeSectionProps) {
  const at = monthIndexer(time);
  const totalFor = (m: string) => {
    const i = at(m);
    return i < 0 ? 0 : time?.totals.hours[i] ?? 0;
  };
  const billableFor = (m: string) => {
    const i = at(m);
    return i < 0 ? 0 : time?.totals.billableHours[i] ?? 0;
  };
  const running = time?.running ?? null;
  const configured = time?.configured ?? false;
  const clients = time?.clients ?? [];

  return (
    <>
      <tr
        className="border-b border-border cursor-pointer hover:bg-muted/20 border-l-section-hours border-l-2"
        onClick={onToggle}
        data-testid="hours-header"
      >
        <td className="sticky left-0 z-10 bg-card px-3 py-2 text-xs font-semibold">
          <div className="flex items-center gap-1">
            {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
            <span>⏱ Hours</span>
            {running && (
              <span
                data-testid="running-dot"
                className="ml-1 h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"
                title={`Timer running: ${[running.clientName, running.projectName, running.description].filter(Boolean).join(' · ') || 'no description'}`}
              />
            )}
            <button
              className="ml-1 p-0.5 rounded hover:bg-accent/50 transition-colors"
              onClick={e => { e.stopPropagation(); onOpenPanel(); }}
              title="Time tracking: sync and client links"
            >
              <Clock className="h-3 w-3" />
            </button>
          </div>
        </td>
        {months.map((m, i) => {
          const total = totalFor(m);
          return (
            <td
              key={m}
              className={`px-3 py-2 text-right text-xs font-semibold tabular-nums ${i === currentMonthIndex ? 'bg-col-highlight' : ''}`}
              title={total ? `${formatHours(total)} worked · ${formatHours(billableFor(m)) || '0h'} billable` : ''}
            >
              {formatHours(total)}
            </td>
          );
        })}
      </tr>

      {open && (
        <>
          {!configured ? (
            <MessageRow months={months} text="Toggl not connected. Set TOGGL_API_TOKEN on the API to pull hours." />
          ) : clients.length === 0 ? (
            <MessageRow months={months} text="No hours synced yet. Sync Now pulls the last 12 months from Toggl." />
          ) : (
            <>
              <tr className="border-b border-border bg-row-summary" data-testid="layer-billable">
                <td className="sticky left-0 z-10 bg-row-summary px-3 py-1 text-xs pl-7">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    Billable
                  </span>
                </td>
                {months.map((m, i) => (
                  <td
                    key={m}
                    className={`px-3 py-1 text-right text-xs tabular-nums text-muted-foreground ${i === currentMonthIndex ? 'bg-col-highlight' : ''}`}
                  >
                    {formatHours(billableFor(m))}
                  </td>
                ))}
              </tr>
              {clients.map((c, idx) => {
                const isAlt = idx % 2 === 1;
                return (
                  <tr key={c.togglClientId ?? 'none'} className={`border-b border-border hover:bg-muted/10 ${isAlt ? 'bg-row-alt' : ''}`}>
                    <td
                      className={`sticky left-0 z-10 px-3 py-1.5 text-xs pl-7 truncate ${isAlt ? 'bg-row-alt' : 'bg-card'} ${c.togglClientId === null ? 'text-muted-foreground italic' : ''}`}
                      title={c.clientKey ? `Linked to pipeline client (${c.linkSource === 'manual' ? 'set by you' : 'matched by name'})` : c.togglClientId === null ? 'Entries with no client' : 'Not linked to a pipeline client'}
                    >
                      {c.clientName}
                    </td>
                    {months.map((m, i) => {
                      const ti = at(m);
                      const hours = ti < 0 ? 0 : c.hours[ti] ?? 0;
                      return (
                        <td
                          key={m}
                          className={`px-3 py-1.5 text-right text-xs tabular-nums ${i === currentMonthIndex ? 'bg-col-highlight' : ''}`}
                          title={cellTitle(c, ti)}
                        >
                          {formatHours(hours)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </>
          )}
        </>
      )}
    </>
  );
}

function MessageRow({ months, text }: { months: string[]; text: string }) {
  return (
    <tr className="border-b border-border">
      <td className="sticky left-0 z-10 bg-card px-3 py-1.5 text-xs pl-7 text-muted-foreground italic whitespace-normal" colSpan={1}>
        {text}
      </td>
      {months.map(m => (
        <td key={m} />
      ))}
    </tr>
  );
}
