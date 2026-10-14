---
title: Retirement planner - Plan
date: 2026-10-14
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: user-request
---

# Retirement planner - Plan

## Goal capsule
Add a Retirement tab beside Cashflow and deploy a useful first version Jim can try at home. Use the supplied Jimbo Retirement Planner workbook as a reference, without committing or embedding its personal financial values. The user authorised autonomous implementation and shipping; unresolved details take the conservative defaults below.

## Product contract
- R1. Cashflow and Retirement are top-level tabs; switching preserves cashflow behaviour and does not change its balances.
- R2. Retirement has editable year, ages, target retirement ages, partner toggle, four asset buckets per person, annual contributions, growth in contributions, real returns for cautious/base/optimistic cases, pension access age and remaining tax-free allowance.
- R3. Income and spending are annual age-bounded rows; income belongs to a person and can be taxable or tax-free. One-off asset contributions/withdrawals have a year and asset bucket. Amounts and projections use today's pounds.
- R4. Show a responsive assets-by-age chart for all three cases, first shortfall age/year, assets at retirement, accessible assets before pension access, and a yearly detail table. Missing/invalid inputs are visible, not treated as healthy zero.
- R5. Model household support symmetrically, stop regular contributions at each person's retirement age, prevent pension access before the configured age, tax pension withdrawals in the withdrawal year, and cap tax-free withdrawals at the remaining allowance.
- R6. XLSX import reads the known workbook's input and assumption sheets in the browser. Import settings and one-off rows; flag its old baseline and review inputs. Do not evaluate arbitrary formula text or import historical charts as current predictions. Validate imported values before replacing the draft.
- R7. A signed-in user explicitly saves a plan to their Floaters connection and can open it on another device. Unsaved changes are a draft; errors and success are visible. JSON export/import provides a portable backup. An illustrative example is clearly labelled and is never saved automatically.
- R8. Explain relevant assumptions next to the results: real returns, future tax bands held in today's money, pooled household drawdown, and no automatic link to company cash. Link to current official tax and pension-age guidance.

## Scope boundaries
No advice/recommendation of investments, market-data fetching, historical US backtests, live pension-provider connections, auto-linking Xero pension payments/dividends, tax optimisation, property liquidation, or Monte Carlo probability claims in this first version. Property and mortgage values from the workbook are not spendable portfolio assets; the importer warns that property/mortgage schedules are not imported.

## Key technical decisions
- KTD1. Use a shared typed model and pure, deterministic annual engine in `packages/types/src/retirement.ts` and `apps/web/src/lib/retirement.ts`. The browser recalculates a draft instantly.
- KTD2. Keep private plans server-side in the existing connection-scoped `scenarios` table as one reserved, inactive Retirement plan with a versioned JSON description. A deterministic UUID derived from the connection and namespace permits idempotent upsert without a migration. No scenario items are written and the plan never enters business forecasting. Filter the reserved record out of the generic scenarios listing; generic scenario detail/items routes return 404 for its reserved id, and the legacy forecast engine rejects this id. This first-version storage choice is isolated in one API route and can migrate later.
- KTD3. `GET/PUT /api/retirement` uses `requireConnection`, validates bounded data, scopes reads to connection and reserved id, returns no-store JSON, and never logs the model. Server saves are explicit, not automatic on each edit.
- KTD4. Retain the workbook's historical starting year on import rather than silently relabelling old balances as current. The default illustrative example starts in the current client year and contains no supplied personal values.
- KTD5. Assume England/Wales/NI income-tax rates for this initial model, with their scope stated. Use the current £12,570 allowance, taper above £100,000, and 20/40/45% bands; future real thresholds stay constant as a modelling assumption. Pension access defaults to 57 and remaining tax-free allowance to £268,275, both editable for protected/used allowances. Returns are already real and net of fees; do not subtract inflation again.
- KTD6. Pension drawdown solves net cash after incremental income tax with a bounded binary search. Withdrawals never exceed available balances; both household members' accessible assets can fund a deficit. Mark unmet spending separately rather than letting negative balances compound.
- KTD7. Use `fflate` for bounded browser-side XLSX ZIP/XML reading, with file/entry/expanded-size limits. Workbook cell text is data, never executable instructions or code. Imports use explicit known-cell mappings.

## Implementation units
### U1 — Model and calculation
Files: `packages/types/src/retirement.ts`, `packages/types/src/index.ts`, `apps/web/src/lib/retirement.ts`, `apps/web/src/lib/retirement.test.ts`.
Tests: growth/contributions and stop ages; no pension access before allowed age; couple support in both directions; income-tax taper/bands; pension allowance cap and same-year tax; one-offs and insufficient funds; all three cases; no inflation double-count; immutable input.

### U2 — Private persistence and imports
Files: `apps/api/src/app/api/retirement/route.ts`, `route.test.ts`, `apps/api/src/app/api/scenarios/route.ts`, scenario detail/items routes, `apps/api/src/lib/forecast/engine.ts`, `apps/web/src/lib/retirement-import.ts`, `retirement-import.test.ts`, `apps/web/src/lib/api.ts`, web package manifest/lock.
Tests: missing auth, connection isolation, reserved inactive id and generic-route/forecast guards, schema and body limits, malformed stored data, DB failures/no sensitive logs; synthetic XLSX mapping, malformed/unrecognised/oversized workbooks, old year preserved, no execution of formulas, JSON validation. Inspect the real workbook locally without copying it into the repo.

### U3 — Retirement UI and navigation
Files: `apps/web/src/pages/RetirementPage.tsx`, `RetirementPage.test.tsx`, `apps/web/src/App.tsx`, existing cashflow desktop/mobile pages for shared tab navigation.
Tests: select Retirement/Cashflow, edit changes projections, partner toggle, import validation, explicit Save and error/retry states, unsaved indicator, yearly rows and three case chart, no writes before Save, responsive code-level layout review.

U1 and U2 establish the contract for U3. They may execute in parallel only after the shared model contract is written. Integration, reviews and deployment stay controller-owned.

## Verification contract
Meaningful engine, importer, API and UI tests; all workspace tests; production web/API builds; changed-file lint; compare known baseline-only type/lint failures rather than relaxing checks. Browser observation is unavailable in the current session, so disclose that and verify UI through interaction tests plus responsive/layout review. Review financial logic and private persistence independently before merge. No spreadsheet/private values go into commits, logs, fixtures, screenshots or public assets.

## Definition of done
The model, import and explicit cross-device save work; Cashflow retains existing tests; all regressions pass; a reviewed PR is merged; GitHub's Railway status succeeds for the merge commit; the live public bundle includes Retirement and its controls. Live private-number verification requires sign-in and must not be claimed from bundle inspection.

## Sources and grounding
- Existing patterns: `apps/web/src/App.tsx`, `apps/web/src/pages/CashflowPage.tsx`, `apps/web/src/lib/api.ts`, `apps/api/src/lib/api-helpers.ts`, `apps/api/supabase/migrations/001_initial_schema.sql`.
- Supplied workbook: Input Tap, Assumptions and One Off ContributionsWithdrawal sheets; source file stays outside the repository.
- https://www.gov.uk/income-tax-rates
- https://www.gov.uk/tax-on-your-private-pension/lump-sum-allowance
- https://www.gov.uk/hmrc-internal-manuals/pensions-tax-manual/ptm028000
