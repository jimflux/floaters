---
title: Link Floaters pension contributions
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
---

# Link Floaters pension contributions

## Goal Capsule
Connect the shipped Retirement planner to Floaters pension payments. The user's clarification explicitly selects pension payments only. Preserve existing saved plans and business cashflow calculations. Continue the authorised build/ship workflow. Research a UK Nutmeg/J.P. Morgan balance feed separately; do not claim support or create a provider connection without verified coverage and credentials.

## Product Contract
- R1. Save optional mappings from a Floaters cost account to a person, percentage share and first linked calendar year. The user selects the recipient; never silently assign company-wide pension payments to an individual. Default new mappings to the current calendar year, with the baseline-balance warning visible.
- R2. Linked amounts replace that person's manual regular pension contribution from the first linked year. Keep other assets and earlier manual years unchanged; stop at that person's retirement age. Sum mapped shares, never add manual plus linked amounts.
- R3. Read the unexcluded Floaters cashflow (12 months back, 24 forward), whose paid/current-remainder/future amounts already supersede projections correctly. Changing the retirement link must not change any company cashflow, invoice, override or pension-provider balance.
- R4. Use known monthly amounts exactly once. Beyond Floaters' window, repeat the final monthly forecast, applying the person's real contribution-growth setting in subsequent calendar years. Explain this extension. Missing historical months or missing/hidden accounts are visible errors for affected linked projections; do not substitute healthy zero or silently revert to manual numbers. Negative pension source months require review rather than guessing their effect on provider balances.
- R5. Show mapping, source window, latest loaded time, annual linked amounts and Refresh. Explicit Save persists mappings through the existing private plan API; JSON import/export includes them. Disconnect restores the manual pension assumption. Show clear unsaved state for changed mappings. Source fetch failures retain draft/export and permit retry, including expired-session sign-in in a new tab.
- R6. Account source data is private/authenticated and current, never written into the public bundle or plan fixtures. No bank/broker credentials requested or embedded. Existing standalone plans/imports continue to work without mappings.
- R7. Opening balances must exclude contributions in linked years; warn particularly when using a current balance with a year-start model. Pension-provider balances are not inferred from company cash payments. No dividend or salary links.

## Key Technical Decisions
- KTD1. Add optional `pensionLinks` to RetirementPlan v1; absent means legacy manual behaviour. Validate bounded mappings in the shared model so existing GET/PUT, JSON import and export stay aligned. Enforce person/account uniqueness, valid year and share, combined account allocation <=100%, and allow disabled-partner settings to be retained.
- KTD2. A pure browser helper calculates per-person annual linked contributions from cashflow months; projection accepts optional live source context and overrides only regular pension contributions. No provider balance updates or hidden one-offs.
- KTD3. Use the existing authenticated cashflow endpoint, no new storage schema or service. A retirement-specific fetch uses back=12&forward=24 and preserves drafts on 401. Refresh live sources on visiting/revisiting Retirement and on explicit Refresh; disclose loaded time, no silent background replacement of drafts.
- KTD4. Preserve manual input values so disconnect is reversible; disable the manual pension amount while linked, with clear explanation of the active year. Annual details distinguish actual/projection source within the known window; future repeated amounts are estimates.

## Implementation Units
### U1 — Model linked pension contributions
Files: packages/types/src/retirement.ts; apps/web/src/lib/retirement-pensions.ts and .test.ts; apps/web/src/lib/retirement.ts and existing .test.ts; existing API retirement test for persistence validation.
Approach: proof-first tests for annual source replacement, shares/people, age stop, start year, growth only beyond source horizon, missing/negative source amounts and backwards-compatible plans. Build a pure helper with a bounded source context. Keep financial engine order unchanged.
Dependencies: none.
### U2 — Add editable links and live source controls
Files: apps/web/src/lib/api.ts and .test.ts; new PensionLinks component and .test.tsx; apps/web/src/pages/RetirementPage.tsx and .test.tsx; apps/web/src/App.tsx only if needed for visibility refresh.
Approach: use U1's contracts, source selector and percentage/date controls, visible source errors, refresh/load timestamp, linked yearly preview; integrate live context into three projections, draft/save/export behaviours. Test explicit linking/disconnect, refresh, pending edits, error/401 preserving draft and linked value replacement. No automatic recipient choice.
Dependencies: U1 committed and verified.

## Verification Contract
Meaningful model, persistence and interaction tests; all existing cashflow/retirement tests; production build; changed-file lint; standalone typecheck compared with known baseline. Independent local code review for financial replacement and draft/error behaviour; no third-party model egress without explicit permission. Browser surface unavailable in prior run: attempt only supported browser tools and report actual coverage honestly.

## Definition of Done
Pension mappings save across devices, linked projections use the existing Floaters monthly values without duplication, manual plans remain compatible, all new checks pass, reviewed change is merged, Railway deployment succeeds and live bundle matches the verified build. Provider-feed research returns official-source evidence and remaining requirements; no invented live connection.
