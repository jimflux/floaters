# Lovable Prompt — Float-style Monthly Cash Flow

Rebuild the entire app as a single-page monthly cash flow view. Delete all existing pages (Dashboard, Transactions, Scenarios, Settings). Replace with one clean view matching the layout below.

## Tech details

- **API base URL**: `https://floaters.onrender.com`
- **Auth**: Every API call must include header `Authorization: Bearer <API_KEY>`. Store the API key in a config/env variable. The user enters it once on first load (simple input + save to localStorage).
- **Currency**: GBP (£). Format all numbers as `£12,527` — no decimals, use comma thousands separator. Negative values in red with minus sign: `-£1,253`.
- **Single API call**: `GET /api/cashflow?back=3&forward=12` returns everything needed.

## API Response Shape

```typescript
{
  currentBalance: number        // today's total bank balance
  fallsBelowZeroIn: string|null // "3 months", "This month", or null (never)
  currentMonthIndex: number     // index into months[] for the current month
  months: string[]              // ["2025-12", "2026-01", "2026-02", ...]
  cashIn: CashflowAccount[]    // income accounts
  cashOut: CashflowAccount[]   // expense accounts
  openingBalance: number[]     // one per month
  closingBalance: number[]     // one per month
  netCashMovement: number[]    // one per month (cash in - cash out)
}

interface CashflowAccount {
  accountCode: string
  accountName: string
  monthly: number[]      // one value per month
  isProjected: boolean[] // true = projected/estimated, false = actual
}
```

## Layout (top to bottom)

### 1. Header bar
- App name "Floaters" on the left
- "Sync Now" button on the right — calls `POST /api/sync` then refetches cashflow data
- Show last sync time if available

### 2. Two headline stat cards (side by side, prominent)

**Left card — "Today's balance"**
- Large £ formatted number from `currentBalance`
- Subtitle: "Total across all bank accounts"

**Right card — "Drops below £0"**
- Shows `fallsBelowZeroIn` value
- If null: show "Never" in green
- If value exists: show it. Red if under 3 months, amber if under 6, green otherwise
- Subtitle: "Based on current projections"

### 3. Line chart — Ending balance by month
- Single line showing `closingBalance` values across all months
- X axis: month labels formatted as "Jan 26", "Feb 26", etc.
- Y axis: £ values
- Historical months (index < currentMonthIndex): solid line
- Future months (index >= currentMonthIndex): dashed line
- Hover tooltip showing "Ending balance — Mar 26: £13,424"
- Current month marker/dot highlighted
- Clean, minimal chart — no grid lines, light grey axis labels
- Use Recharts or similar

### 4. Cash flow table — THE MAIN EVENT

This is a spreadsheet-style table. Horizontal scroll for months.

**Columns**: One per month. Format month headers as "Jan 26", "Feb 26", "Mar 26" etc. Highlight the current month column (light blue background on header and cells).

**Rows** (in this exact order):

1. **Starting balance** — `openingBalance[]` values. Bold row, light grey background.

2. **Income** section header row — show "↗ Income" with a collapse/expand toggle. When expanded, show child rows:
   - One row per item in `cashIn[]`, showing `accountName` on left and `monthly[]` values across
   - A **Total Income** summary row (sum of all cashIn monthly values per month). Semi-bold.

3. **Costs** section header row — show "↘ Costs" with a collapse/expand toggle. When expanded, show child rows:
   - One row per item in `cashOut[]`, showing `accountName` on left and `monthly[]` values across
   - A **Total Costs** summary row (sum of all cashOut monthly values per month). Semi-bold.

4. **Net cash movement** — `netCashMovement[]` values. Bold row. Negative values in red.

5. **Ending balance** — `closingBalance[]` values. Bold row, light grey background.

**Cell styling:**
- Projected cells (where `isProjected[i]` is true): lighter/muted text colour (e.g. text-gray-400 instead of text-gray-900)
- Actual cells: normal dark text
- The account name column is fixed/sticky on the left (doesn't scroll with months)
- All values right-aligned
- Compact row height — this should feel like a spreadsheet, not a card layout

### 5. No other pages

Remove all navigation. This is a single view. No sidebar, no tabs, no router. Just this one page.

## Styling

- Clean, minimal, lots of whitespace
- White background, subtle borders between rows (border-gray-100)
- Font: system font stack, or Inter if available
- Section headers (Income, Costs) slightly larger, with the arrow icon
- The table should take up the full width of the viewport
- Responsive: on mobile, the headline cards stack vertically, and the table scrolls horizontally
- No dark mode needed for now

## Important implementation notes

- All data comes from ONE API call: `GET /api/cashflow?back=3&forward=12`
- Handle loading state (skeleton/spinner while fetching)
- Handle error state (show error message if API returns non-200)
- Handle auth: if no API key in localStorage, show a simple "Enter your API key" input before loading anything
- The "Sync Now" button should show a loading spinner while syncing, then refetch the cashflow data
- Do NOT call any other API endpoints. Everything is in `/api/cashflow`.
