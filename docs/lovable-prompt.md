# Lovable Prompt

Build a cash flow forecasting dashboard app. Single-page app feel, Vercel UI aesthetic — clean, minimal, lots of whitespace, sharp typography, dark/light mode.

Use FLUX brand colours: [ADD YOUR HEX CODES]
Use FLUX fonts: [ADD YOUR FONT NAMES]

The app connects to a backend API at [YOUR_RAILWAY_URL]. All data comes from API calls.

## Pages

### 1. Dashboard (main view) — Cash flow forecast chart
- Area/bar chart: inflows (green), outflows (red), running balance line
- Period toggle: Daily / Weekly / Monthly
- Time range: 30d, 90d, 6m, 1y, 3y
- Scenario toggle chips above the chart (on/off switches)
- Cash threshold shown as horizontal dashed red line
- Click any bar/point to drill down to that day's transactions
- Sync status badge: "Last synced 2h ago" + manual sync button
- Currency: GBP (£)

### 2. Transactions — Day-level drill-down
- Table: Date, Type (in/out), Contact, Description, Amount, Status
- Inline date picker to adjust expected payment date
- Filter by type, status

### 3. Scenarios — What-if planning
- List of scenarios with active/inactive toggle
- Create scenario: name, description
- Add items: type (income/expense), amount, frequency (once/weekly/monthly/quarterly/yearly), start date, end date

### 4. Budgets — Budget vs actuals
- Side-by-side bar chart per category per month
- Variance column (£ and %)

### 5. Settings
- Connection status (org name, last sync)
- Cash threshold input (minimum balance £)
- Account grouping (drag accounts into groups)
- Disconnect button

## API Endpoints

All responses are JSON. Auth is handled via httpOnly cookie (set by /auth/callback).

- `GET /api/connection` — connected org info + bank balances
- `GET /api/sync-status` — last synced, status, errors
- `POST /api/xero/sync` — trigger manual sync
- `GET /api/forecast?period=daily&from=...&to=...&scenarios=id1,id2` — forecast data
- `GET /api/forecast/transactions?date=2026-03-15` — day-level drill-down
- `PATCH /api/adjustments/:id` — body: `{ "expected_payment_date": "2026-04-01" }`
- `GET/POST /api/scenarios` — list / create scenarios
- `GET/PATCH/DELETE /api/scenarios/:id` — read / update / delete scenario
- `POST /api/scenarios/:id/items` — add scenario item
- `PATCH/DELETE /api/scenarios/:id/items/:itemId` — edit / remove item
- `GET/POST /api/budgets` — list / create budgets
- `GET/PATCH/DELETE /api/budgets/:id` — read / update / delete budget
- `POST /api/budgets/:id/lines` — add budget line
- `GET /api/budgets/:id/comparison` — budget vs actuals data
- `GET/POST/PATCH/DELETE /api/thresholds` — cash threshold (single per connection)
- `GET/POST/PATCH/DELETE /api/account-groups` — account grouping
