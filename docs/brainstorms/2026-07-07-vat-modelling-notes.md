# VAT modelling — brainstorm seed (2026-07-07)

Captured at session check-out, not yet designed. Run `/ce-brainstorm` (then `/ce-plan`) on this next session — there are real accounting decisions here that shouldn't be zero-shot.

## What Jim asked for

> "we need to dynamically calculate VAT — I pay it every quarter — all UK companies I invoice will be VAT included, so that's PropellerNet and Regent Exhibitions, not IKEA."

In plain terms:
- Jim charges VAT to his UK clients, so their invoices/receipts are VAT-inclusive. He then owes that collected VAT to HMRC and pays it **quarterly**.
- VATable status is **per client**: PropellerNet and Regent Exhibitions are VATable; IKEA is not (likely an overseas / out-of-scope entity, so no UK VAT).
- The dashboard should reflect the VAT he will owe, so the forecast stops being over-optimistic.

## Why it matters

The cashflow forecast currently ignores VAT liability entirely: it counts the full VAT-inclusive cash in, but never subtracts the quarterly VAT payment out. So the committed balance line is too high by roughly the accrued-but-unpaid VAT. For a cashflow tool whose whole job is "do I have the money", that is a real hole.

## Current state (verified in code, 2026-07-07)

- No tax/VAT columns are synced from Xero. `xero_invoices` stores `total` (VAT-inclusive) and `line_items` (tax-exclusive `LineAmount`); the cashflow route scales line items up to the inclusive total. VAT is implicit in `total`, never separated or tracked.
- No per-client VATable flag anywhere.
- No VAT liability accrual and no quarterly VAT payment in the forecast.
- Projections are entered VAT-inclusive (R14) with no VAT portion extracted.

## Open questions for the brainstorm

- **VAT scheme**: standard, flat-rate, or cash-accounting VAT? This changes how the liability and payment are computed. (Flat-rate especially: the payment is a % of gross turnover, not output minus input VAT.)
- **Input VAT**: net the VAT on his costs/purchases against output VAT (standard scheme), or ignore costs (flat-rate)? Costs are still account-based ACCPAY; is the VAT on them recoverable and worth modelling?
- **VATable determination**: a per-client flag Jim sets (PropellerNet/Regent yes, IKEA no), or read the actual tax from Xero on real invoices and only need the flag for projections? Xero holds the true tax per invoice, so "dynamically calculate" may mean: use Xero's tax for synced invoices, apply a rate (20%?) to VATable projections, zero for non-VATable.
- **Quarter cadence + payment date**: which quarter-end months are Jim's VAT quarters, and the payment lands ~1 month + 7 days after quarter end (UK deadline). Model the payment as a projected cost outflow on that date.
- **Rate**: assume 20% standard, or store per client/line? Read from Xero where present.
- **Presentation**: does VAT show as its own cost row / dedicated line, and does the accrued-VAT-to-date show anywhere (a "VAT owed" stat)?

## Likely shape (pre-decision, for orientation only)

- A per-client VATable flag (probably on `income_projections` and/or a small client-settings table; real invoices can read Xero tax).
- Accrue output VAT on VATable receipts; optionally net input VAT on costs.
- Project the quarterly VAT bill as a cost outflow on the return due dates, so both balance lines drop when it's paid.
- Extract the VAT portion of VAT-inclusive projections for the VATable clients only.
