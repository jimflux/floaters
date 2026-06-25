# Update: Chart of Accounts grouping + Account Management

The backend API has been updated. The cashflow data now groups by Xero chart of accounts (e.g. "Sales", "Advertising & Marketing", "Rent") instead of bank accounts or contact names. There's also a new account management feature to hide/show accounts.

**You do NOT need to rebuild the page.** Keep the existing layout (headline cards, chart, table). Just update the data handling and add the account management panel.

## What changed in the API

### `/api/cashflow` response has a new field: `accounts`

The response now includes an `accounts` array listing all P&L accounts from Xero's chart of accounts:

```typescript
{
  // ... existing fields unchanged ...
  accounts: CashflowAccountInfo[]
}

interface CashflowAccountInfo {
  code: string             // Xero account code e.g. "200", "400"
  name: string             // e.g. "Sales", "Advertising & Marketing"
  type: string             // REVENUE, SALES, DIRECTCOSTS, OVERHEADS, EXPENSE
  section: "income" | "costs"
  hidden: boolean          // true if user has hidden this account
}
```

Each account in `cashIn` and `cashOut` now has a new field:

```typescript
interface CashflowAccount {
  accountCode: string
  accountName: string
  monthly: number[]
  isProjected: boolean[]
  hasOverride: boolean[]   // NEW: true if the month has a manual projection override
}
```

Three visual states per cell:
- **Actual** (`isProjected: false`) — default styling, not editable
- **Auto-projected** (`isProjected: true`, `hasOverride: false`) — italic or muted text, editable
- **Manual override** (`isProjected: true`, `hasOverride: true`) — blue text with small indicator (pencil icon or dot), editable

### New API endpoints

- **Hide account**: `POST /api/hidden-accounts` with body `{ "accountCode": "XXX" }`
- **Unhide account**: `DELETE /api/hidden-accounts?accountCode=XXX`
- **Create group**: `POST /api/account-groups` with body `{ "name": "...", "accountCodes": ["200", "201"] }`
- **List groups**: `GET /api/account-groups` returns `{ groups: [{ id, name, accountCodes, color, createdAt }] }`
- **Delete group**: `DELETE /api/account-groups?id=XXX`
- **Set projection override**: `PUT /api/projection-overrides` with body `{ "accountCode": "200-EDI", "month": "2026-04", "amount": 5000 }`
- **Remove projection override**: `DELETE /api/projection-overrides?accountCode=200-EDI&month=2026-04`
- **List all overrides**: `GET /api/projection-overrides` returns `{ overrides: [{ accountCode, month, amount }] }`

## Changes to make

### 1. Add gear icon to header bar

Add a gear/settings icon button next to the existing "Sync Now" button. Clicking it opens an account management slide-over panel from the right.

### 2. Account management panel (new)

Slide-over panel from the right, white background, shadow. Two tabs:

**Tab 1: "Accounts"**
- List all items from the `accounts` array in the cashflow response
- Group them under two headings: "Income Accounts" and "Cost Accounts" (based on `section` field)
- Each row shows: account name, account code (small/muted), and a toggle switch
- Toggle is ON if `hidden` is false, OFF if `hidden` is true
- Toggling ON→OFF calls `POST /api/hidden-accounts` with `{ "accountCode": "XXX" }`
- Toggling OFF→ON calls `DELETE /api/hidden-accounts?accountCode=XXX`
- After any toggle, refetch `/api/cashflow` so the table updates (hidden accounts disappear from the table)

**Tab 2: "Groups"**
- Show existing groups from `GET /api/account-groups`
- Each group shows: name, list of member account names, and a delete button (calls `DELETE /api/account-groups?id=XXX`)
- "Create Group" button opens a simple form:
  - Text input for group name
  - Multi-select/checkbox list of available accounts (from the `accounts` array)
  - Submit calls `POST /api/account-groups` with `{ "name": "...", "accountCodes": ["200", "400"] }`
- Groups are for future use — they don't change the table yet, just stored for later

### 3. Editable projected cells (new)

Any cell in the table where `isProjected[i]` is true should be clickable/editable. This lets the user manually set projected amounts for future months.

**Interaction:**
- Clicking a projected cell opens an inline input or small popover with a number field, pre-filled with the current value
- On save: call `PUT /api/projection-overrides` with `{ "accountCode": "...", "month": "2026-04", "amount": 5000 }`, then refetch `/api/cashflow`
- On clear/reset (small "x" or "reset" button): call `DELETE /api/projection-overrides?accountCode=...&month=2026-04`, then refetch `/api/cashflow` — this reverts to the default projection (3-month average for costs, or invoice-only for income)

**Visual states:**
- Cells where `hasOverride[i]` is true should have a distinct style (e.g. blue text, small pencil icon) so the user can see which values they've manually set
- Cells where `isProjected[i]` is true but `hasOverride[i]` is false should look subtly different from actuals (e.g. italic or slightly muted) to show they're auto-projected

### 4. No other changes needed

The chart and headline cards should already work with the data. The account names are chart of accounts names.
