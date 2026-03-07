# Update: Editable projected cells + copy previous month

Keep the existing layout. This adds the ability to click on projected cells in the cashflow table and manually set amounts.

## API response change

Each account in `cashIn` and `cashOut` now has `hasOverride: boolean[]` alongside `isProjected: boolean[]`. Same length as `monthly[]`.

## Three visual states per cell

- **Actual** (`isProjected: false`) — default styling, not editable
- **Auto-projected** (`isProjected: true`, `hasOverride: false`) — italic or slightly muted text, editable on click
- **Manual override** (`isProjected: true`, `hasOverride: true`) — blue text with a small pencil icon or coloured dot, editable on click

## Clicking a projected cell

When the user clicks any cell where `isProjected[i]` is true, show an inline input or small popover:

- Number field, pre-filled with the current value
- **"Copy previous"** button — takes the value from the previous month's cell (`monthly[i-1]`) and fills the input
- **Save** button — calls `POST /api/projection-overrides` with:
  ```json
  { "accountCode": "200-EDI", "month": "2026-04", "amount": 5000 }
  ```
  Then refetch `/api/cashflow` to update the table
- **Reset** button (only shown if `hasOverride[i]` is true) — calls:
  ```
  DELETE /api/projection-overrides?accountCode=200-EDI&month=2026-04
  ```
  Then refetch `/api/cashflow` — this reverts to the default projection (3-month average for costs, or invoice-only for income)

## API endpoints

- **Save override**: `POST /api/projection-overrides` with body `{ "accountCode": "...", "month": "2026-04", "amount": 5000 }`
- **Remove override**: `DELETE /api/projection-overrides?accountCode=...&month=2026-04`
- **List all overrides**: `GET /api/projection-overrides` returns `{ overrides: [{ accountCode, month, amount }] }`

## Notes

- If an actual invoice comes in from Xero for a month that has a manual override, the invoice amount takes priority automatically — the override is ignored and `hasOverride` will be false for that month
- Only future/projected months are editable. Historical months (where `isProjected` is false) cannot be edited
- No other changes needed to the chart, headline cards, or account management panel
