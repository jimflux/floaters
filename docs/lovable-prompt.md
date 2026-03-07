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

The `cashIn` and `cashOut` arrays now use chart of accounts names (e.g. "Sales", "Rent") instead of bank account or contact names. No change to the shape — `accountCode`, `accountName`, `monthly[]`, `isProjected[]` are all the same.

### New API endpoints

- **Hide account**: `POST /api/hidden-accounts` with body `{ "accountCode": "XXX" }`
- **Unhide account**: `DELETE /api/hidden-accounts?accountCode=XXX`
- **Create group**: `POST /api/account-groups` with body `{ "name": "...", "accountCodes": ["200", "201"] }`
- **List groups**: `GET /api/account-groups` returns `{ groups: [{ id, name, accountCodes, color, createdAt }] }`
- **Delete group**: `DELETE /api/account-groups?id=XXX`

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

### 3. No other changes needed

The table, chart, and headline cards should already work with the new data — the API shape for `cashIn`, `cashOut`, `openingBalance`, `closingBalance`, `netCashMovement` is unchanged. The account names will just be different (chart of accounts names instead of bank/contact names).
