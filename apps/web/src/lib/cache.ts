// localStorage warm-start keys, versioned: the response shape broke when
// income became layered (v2), and a stale pre-break payload hydrating the new
// UI would crash it — the web build does not typecheck, so the version bump is
// the only guard. v3 adds the VAT surfaces (vatAdjustedClosing, vatOwedNow, the
// VAT_LIABILITY cost row); additive, but bumped so a stale v2 payload can't
// hydrate the VAT-aware UI. v4 adds vatProjectedBill (issued + projected VAT for
// the VAT cost row on the projected view).
export const CASHFLOW_CACHE_KEY = 'cashflow_cache_v4';
export const OVERRIDES_CACHE_KEY = 'projection_overrides_cache_v2';

/** Drops the cached financial data, so it doesn't outlive the session in this browser. */
export function clearCachedData(): void {
  for (const key of [CASHFLOW_CACHE_KEY, OVERRIDES_CACHE_KEY]) {
    try { localStorage.removeItem(key); } catch { /* storage can be blocked */ }
  }
}
