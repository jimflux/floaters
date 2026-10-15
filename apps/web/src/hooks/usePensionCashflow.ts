import { useCallback, useEffect, useRef, useState } from 'react';
import { getRetirementPensionCashflow } from '@/lib/api';
import type { PensionCashflow } from '@/lib/retirement-pensions';

export function usePensionCashflow(active: boolean) {
  const [source, setSource] = useState<PensionCashflow>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const next = await getRetirementPensionCashflow();
      if (request !== sequence.current) return;
      setSource(next);
      setLoadedAt(new Date().toISOString());
    } catch (failure) {
      if (request !== sequence.current) return;
      setError(failure instanceof Error ? failure : new Error('Could not load Floaters pension cashflow.'));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (active) void refresh();
    return () => { sequence.current += 1; };
  }, [active, refresh]);
  return { source, loading, error, loadedAt, refresh };
}
