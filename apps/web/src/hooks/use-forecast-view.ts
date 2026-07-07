import { useState } from 'react';

// Which basis the dashboard majors on: "committed" (real cash, the safe
// headline) or "projected" (the optimistic walk: committed plus unfulfilled
// projection remainders). The backend already returns both; this only
// switches which one the chart, stats and summary rows lead with. Persisted
// so the choice survives reloads.
export type ForecastView = 'committed' | 'projected';

const KEY = 'floaters_forecast_view';

export function useForecastView(): [ForecastView, (v: ForecastView) => void] {
  const [view, setView] = useState<ForecastView>(() => {
    try {
      return localStorage.getItem(KEY) === 'projected' ? 'projected' : 'committed';
    } catch {
      return 'committed';
    }
  });

  const set = (v: ForecastView) => {
    setView(v);
    try { localStorage.setItem(KEY, v); } catch { /* best-effort */ }
  };

  return [view, set];
}
