# Lovable Prompt — Float-style Monthly Cash Flow

Rebuild the entire app as a single-page monthly cash flow view. Delete all existing pages (Dashboard, Transactions, Scenarios, Settings). Replace with one clean view matching the layout below.

## Tech details

- **API base URL**: `https://floaters.onrender.com`
- **Auth**: Every API call must include header `Authorization: Bearer <API_KEY>`. Store the API key in a config/env variable. The user enters it once on first load (simple input + save to localStorage).
- **Currency**: GBP (£). Format all numbers as `£12,527` — no decimals, use comma thousands separator. Negative values in red with minus sign: `-£1,253`.
- **Main data**: `GET /api/cashflow?back=3&forward=12`
- **Sync**: `POST /api/sync`
- **Hide account**: `POST /api/hidden-accounts` with body `{ "accountCode": "XXX" }`
- **Unhide account**: `DELETE /api/hidden-accounts?accountCode=XXX`
- **Create group**: `POST /api/account-groups` with body `{ "name": "...", "accountCodes": ["200", "201"] }`
- **List groups**: `GET /api/account-groups` returns `{ groups: [...] }`
- **Delete group**: `DELETE /api/account-groups?id=XXX`

## API Response Shape — `/api/cashflow`

```typescript
{
  currentBalance: number        // today's total bank balance
  fallsBelowZeroIn: string|null // "3 months", "This month", or null (never)
  currentMonthIndex: number     // index into months[] for the current month
  months: string[]              // ["2025-12", "2026-01", "2026-02", ...]
  cashIn: CashflowAccount[]    // income accounts (from chart of accounts)
  cashOut: CashflowAccount[]   // cost accounts (from chart of accounts)
  openingBalance: number[]     // one per month
  closingBalance: number[]     // one per month
  netCashMovement: number[]    // one per month (cash in - cash out)
  accounts: CashflowAccountInfo[] // all P&L accounts for management
}

interface CashflowAccount {
  accountCode: string      // Xero chart of accounts code
  accountName: string      // e.g. "Sales", "Advertising & Marketing", "Rent"
  monthly: number[]        // one value per month
  isProjected: boolean[]   // true = projected/estimated, false = actual
}

interface CashflowAccountInfo {
  code: string
  name: string
  type: string             // REVENUE, SALES, DIRECTCOSTS, OVERHEADS, EXPENSE
  section: "income" | "costs"
  hidden: boolean
}
```

## Layout (top to bottom)

### 1. Header bar
- App name "Floaters" on the left
- Gear icon (opens account management panel) and "Sync Now" button on the right
- Sync button calls `POST /api/sync` then refetches cashflow data

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
   - Account names come from Xero chart of accounts (e.g. "Sales", "Other Revenue", "Interest Income")
   - A **Total Income** summary row (sum of all cashIn monthly values per month). Semi-bold.

3. **Costs** section header row — show "↘ Costs" with a collapse/expand toggle. When expanded, show child rows:
   - One row per item in `cashOut[]`, showing `accountName` on left and `monthly[]` values across
   - Account names like "Advertising & Marketing", "Rent", "Software Subscriptions", "Travel", "VAT"
   - A **Total Costs** summary row (sum of all cashOut monthly values per month). Semi-bold.

4. **Net cash movement** — `netCashMovement[]` values. Bold row. Negative values in red.

5. **Ending balance** — `closingBalance[]` values. Bold row, light grey background.

**Cell styling:**
- Projected cells (where `isProjected[i]` is true): lighter/muted text colour (e.g. text-gray-400 instead of text-gray-900)
- Actual cells: normal dark text
- The account name column is fixed/sticky on the left (doesn't scroll with months)
- All values right-aligned
- Compact row height — this should feel like a spreadsheet, not a card layout

### 5. Account management panel

Triggered by the gear icon in the header. Opens as a slide-over panel from the right.

**Two tabs:**

**Tab 1: "Accounts"**
- List all items from `accounts[]` in the cashflow response
- Grouped by section: "Income Accounts" and "Cost Accounts"
- Each account shows: name, code, and a toggle switch (on = visible, off = hidden)
- Toggle calls `POST /api/hidden-accounts` to hide or `DELETE /api/hidden-accounts?accountCode=XXX` to unhide
- After toggling, refetch cashflow data so the table updates
- Accounts that are hidden show as greyed out in the list

**Tab 2: "Groups"**
- List existing groups from `GET /api/account-groups`
- Each group shows name, member account codes, and a delete button
- "Create Group" button at the bottom:
  - Opens a small form: group name input + multi-select of available accounts (from the `accounts[]` list)
  - Submit calls `POST /api/account-groups` with `{ name, accountCodes }`
- Groups are NOT yet used in the table (future feature) — this is just for setup

### 6. No other pages

This is a single view. No sidebar, no tabs, no router.

## Styling

- Clean, minimal, lots of whitespace
- White background, subtle borders between rows (border-gray-100)
- Font: system font stack, or Inter if available
- Section headers (Income, Costs) slightly larger, with the arrow icon
- The table should take up the full width of the viewport
- Responsive: on mobile, the headline cards stack vertically, and the table scrolls horizontally
- No dark mode needed for now
- Account management panel: white background, shadow, slide in from right

## Important implementation notes

- Main data from `GET /api/cashflow?back=3&forward=12`
- Handle loading state (skeleton/spinner while fetching)
- Handle error state (show error message if API returns non-200)
- Handle auth: if no API key in localStorage, show a simple "Enter your API key" input before loading anything
- The "Sync Now" button should show a loading spinner while syncing, then refetch the cashflow data
- After hiding/unhiding accounts, refetch cashflow data
