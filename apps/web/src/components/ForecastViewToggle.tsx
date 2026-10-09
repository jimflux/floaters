import type { ForecastView } from '@/hooks/use-forecast-view';

// Segmented control to major the dashboard on committed (real cash) or
// projected (if projections land). Keep it compact; it sits in the header.
// `tone` only picks colours for the ground it sits on (aubergine header or a
// light card).
export default function ForecastViewToggle({ view, onChange, tone = 'light' }: {
  view: ForecastView;
  onChange: (v: ForecastView) => void;
  tone?: 'light' | 'dark';
}) {
  const options: { value: ForecastView; label: string }[] = [
    { value: 'committed', label: 'Committed' },
    { value: 'projected', label: 'Projected' },
  ];
  const dark = tone === 'dark';
  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-full p-1 text-xs ${dark ? 'bg-white/10' : 'bg-cloud'}`}
      role="group"
      aria-label="Forecast basis"
    >
      {options.map(o => {
        const active = view === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`min-h-8 px-3.5 rounded-full font-semibold transition-colors ${
              active
                ? dark ? 'bg-cloud text-aubergine' : 'bg-aubergine text-cloud'
                : dark ? 'text-muted-on-aubergine hover:text-cloud' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
