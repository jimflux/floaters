import { SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { CashflowData } from '@/lib/types';

export interface ForecastExclusions { costs: string[]; clients: string[] }

export default function ForecastRows({ data, exclusions, onChange }: {
  data: CashflowData;
  exclusions: ForecastExclusions;
  onChange: (value: ForecastExclusions) => void;
}) {
  const count = exclusions.costs.length + exclusions.clients.length;
  const toggle = (kind: keyof ForecastExclusions, key: string) => {
    const values = exclusions[kind];
    onChange({ ...exclusions, [kind]: values.includes(key) ? values.filter(v => v !== key) : [...values, key] });
  };
  const costs = (data.accounts ?? []).filter(a => a.section === 'costs' && !(data.vatOwedNow != null && a.name.trim().toUpperCase() === 'VAT'));
  if (data.vatOwedNow != null) costs.push({ code: 'VAT_LIABILITY', name: 'VAT', section: 'costs', type: 'CURRENTLIABILITY', hidden: false });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-foreground" aria-label="Choose forecast rows">
          <SlidersHorizontal className="h-4 w-4" /> Rows{count > 0 ? ` (${count} excluded)` : ''}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="font-semibold">Include in forecast</p>
        <p className="text-xs text-muted-foreground mt-1 mb-3">Untick a row to try the forecast without its future amounts. Recorded payments stay included. These changes last until you reload.</p>
        <div className="max-h-80 overflow-y-auto space-y-3">
          {(['clients', 'costs'] as const).map(kind => (
            <div key={kind}>
              <p className="text-xs font-semibold text-muted-foreground mb-1">{kind === 'clients' ? 'Income' : 'Costs'}</p>
              {(kind === 'clients' ? data.income.clients.map(c => ({ key: c.clientKey, name: c.clientName })) : costs.map(c => ({ key: c.code, name: c.name }))).map(row => (
                <label key={row.key} className="flex items-center gap-2 py-1.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={!exclusions[kind].includes(row.key)} onChange={() => toggle(kind, row.key)} aria-label={`Include ${row.name}`} />
                  {row.name}
                </label>
              ))}
            </div>
          ))}
        </div>
        {count > 0 && <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => onChange({ costs: [], clients: [] })}>Restore all rows</Button>}
      </PopoverContent>
    </Popover>
  );
}
