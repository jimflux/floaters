import type { ForecastView } from '@/hooks/use-forecast-view';

// Segmented control to major the dashboard on committed (real cash) or
// projected (if projections land). Keep it compact; it sits in the header.
export default function ForecastViewToggle({ view, onChange }: {
  view: ForecastView;
  onChange: (v: ForecastView) => void;
}) {
  const options: { value: ForecastView; label: string }[] = [
    { value: 'committed', label: 'Committed' },
    { value: 'projected', label: 'Projected' },
  ];
  return (
    <div className="inline-flex items-center rounded-md border border-border overflow-hidden text-xs" role="group" aria-label="Forecast basis">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={view === o.value}
          className={`px-2.5 py-1 transition-colors ${
            view === o.value
              ? 'bg-foreground text-background font-medium'
              : 'text-muted-foreground hover:bg-muted/40'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
