import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { supabase } from "@/lib/supabase";
import { NextRequest } from "next/server";
import { format, addMonths, subMonths, startOfMonth } from "date-fns";
import { z } from "zod/v4";
import { HISTORY_MONTHS } from "@/lib/xero/sync";
import {
  expandProjection,
  invoiceBucketMonth,
  clientKey,
  type ProjectionRow,
} from "@/lib/pipeline";
import type {
  CashflowResponse,
  CashflowAccount,
  CashflowAccountInfo,
  IncomeClient,
} from "@/types/api";

// Interest income arrives as OTHERINCOME; without it R7 lands in costs as a
// negative.
const INCOME_TYPES = new Set(["REVENUE", "SALES", "OTHERINCOME"]);
// Everything that isn't income goes into costs

// Cost projections use a 3-month historical average
const HISTORY_FOR_AVG = 3;

// back is capped at the synced history depth: months beyond it would show
// payments against zero bank data and reconstruct confidently wrong balances
const querySchema = z.object({
  back: z.coerce.number().int().min(0).max(HISTORY_MONTHS).default(3),
  forward: z.coerce.number().int().min(1).max(24).default(12),
});

interface LineItem {
  AccountCode: string;
  LineAmount: number;
  Description?: string;
}

export async function GET(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const { searchParams } = new URL(request.url);

    const parsed = querySchema.safeParse({
      back: searchParams.get("back") ?? undefined,
      forward: searchParams.get("forward") ?? undefined,
    });
    if (!parsed.success) {
      return error(
        `Invalid window: back must be 0-${HISTORY_MONTHS}, forward must be 1-24`
      );
    }
    const { back: monthsBack, forward: monthsForward } = parsed.data;

    const now = startOfMonth(new Date());
    const from = subMonths(now, monthsBack);
    const to = addMonths(now, monthsForward);
    // Cash is fetched at least 3 months back so the cost average holds up
    // even when the visible window is narrower
    const cashFrom = subMonths(now, Math.max(monthsBack, HISTORY_FOR_AVG));

    // Build month keys
    const months: string[] = [];
    let cursor = from;
    while (cursor < to) {
      months.push(format(cursor, "yyyy-MM"));
      cursor = addMonths(cursor, 1);
    }
    const currentMonth = format(now, "yyyy-MM");
    const currentMonthIndex = months.indexOf(currentMonth);

    // Fetch all data in parallel
    const [
      bankTxnResult,
      paymentResult,
      invoiceResult,
      bankAccountResult,
      accountsResult,
      hiddenResult,
      overrideResult,
      projectionResult,
      assignedResult,
    ] = await Promise.all([
      supabase
        .from("xero_bank_transactions")
        .select("type, total, date, status, line_items")
        .eq("connection_id", connectionId)
        .gte("date", format(cashFrom, "yyyy-MM-dd"))
        .order("date", { ascending: true }),
      supabase
        .from("xero_payments")
        .select("payment_type, amount, date, status, invoice_xero_id")
        .eq("connection_id", connectionId)
        .gte("date", format(cashFrom, "yyyy-MM-dd")),
      supabase
        .from("xero_invoices")
        .select(
          "xero_id, type, total, amount_due, due_date, expected_payment_date, status, line_items, contact_id, contact_name"
        )
        .eq("connection_id", connectionId)
        .in("status", ["AUTHORISED", "SUBMITTED"]),
      supabase
        .from("xero_accounts")
        .select("current_balance")
        .eq("connection_id", connectionId)
        .eq("type", "BANK"),
      // All active accounts, including BANK: bank codes distinguish transfer
      // legs (dropped) from genuinely unknown codes (uncategorised)
      supabase
        .from("xero_accounts")
        .select("code, name, type")
        .eq("connection_id", connectionId)
        .eq("status", "ACTIVE"),
      supabase
        .from("hidden_accounts")
        .select("account_code")
        .eq("connection_id", connectionId),
      supabase
        .from("projection_overrides")
        .select("account_code, month, amount")
        .eq("connection_id", connectionId),
      supabase
        .from("income_projections")
        .select("*")
        .eq("connection_id", connectionId),
      // Every invoice linked to a projection, any status: remainders net
      // against totals (R14, VOIDED/DELETED excluded in the helper); dates let
      // recurring projections attribute consumption to the matching occurrence.
      supabase
        .from("xero_invoices")
        .select("xero_id, projection_id, status, total, due_date, expected_payment_date")
        .eq("connection_id", connectionId)
        .not("projection_id", "is", null),
    ]);

    const bankTxns = bankTxnResult.data || [];
    const payments = paymentResult.data || [];
    const openInvoices = invoiceResult.data || [];
    const bankAccounts = bankAccountResult.data || [];
    const chartAccounts = accountsResult.data || [];
    const projections = projectionResult.data || [];
    const assignedInvoices = assignedResult.data || [];
    const hiddenCodes = new Set(
      (hiddenResult.data || []).map((r) => r.account_code)
    );

    // Payments attribute via their invoice: ACCREC whole-amount by client,
    // ACCPAY via line items. Those invoices are often PAID (excluded from the
    // open-invoice query above), so fetch them separately by id, any status.
    const paymentInvoiceIds = [
      ...new Set(
        payments
          .filter((p) => p.status !== "DELETED")
          .map((p) => p.invoice_xero_id as string)
      ),
    ];
    const attributionInvoices =
      paymentInvoiceIds.length > 0
        ? (
            await supabase
              .from("xero_invoices")
              .select("xero_id, type, total, line_items, contact_id, contact_name")
              .eq("connection_id", connectionId)
              .in("xero_id", paymentInvoiceIds)
          ).data || []
        : [];
    const invoiceById = new Map(
      attributionInvoices.map((inv) => [inv.xero_id as string, inv])
    );

    // Build override lookup: accountCode -> month -> amount. Income overrides
    // retired at cutover: only the costs section reads these (R12).
    const overrideLookup = new Map<string, Map<string, number>>();
    for (const o of overrideResult.data || []) {
      if (!overrideLookup.has(o.account_code)) {
        overrideLookup.set(o.account_code, new Map());
      }
      overrideLookup.get(o.account_code)!.set(o.month, Number(o.amount));
    }

    const currentBalance = bankAccounts.reduce(
      (sum, a) => sum + (Number(a.current_balance) || 0),
      0
    );

    // Chart of accounts lookup (includes BANK accounts for transfer detection)
    const accountLookup = new Map<string, { name: string; type: string }>();
    for (const acc of chartAccounts) {
      if (acc.code) {
        accountLookup.set(acc.code, { name: acc.name, type: acc.type });
      }
    }

    // -----------------------------------------------------------------------
    // Income: a pipeline of items rolled up by client in three layers.
    // Costs: the account model, unchanged.
    // -----------------------------------------------------------------------

    type MonthTotals = Map<string, number>;
    type AccountData = { name: string; type: string; months: MonthTotals };
    type AccountMap = Map<string, AccountData>;

    const actualOut: AccountMap = new Map();
    const projectedOut: AccountMap = new Map();
    // Net actual cash per month (in minus out) across every flow; drives the
    // balance anchor split for the current month. Whole ACCREC payments are
    // counted here — the walk reconciles to the bank, not to the account
    // passes.
    const actualMonthNet = new Map<string, number>();

    type ClientData = {
      name: string;
      nameRank: number; // invoice names beat projection labels beat fallback
      paid: MonthTotals;
      invoiced: MonthTotals;
      projected: MonthTotals;
      overdue: Set<string>;
    };
    const incomeClients = new Map<string, ClientData>();

    function clientFor(key: string): ClientData {
      let c = incomeClients.get(key);
      if (!c) {
        c = {
          name: key === "UNASSIGNED" ? "Unassigned" : "",
          nameRank: key === "UNASSIGNED" ? 3 : 0,
          paid: new Map(),
          invoiced: new Map(),
          projected: new Map(),
          overdue: new Set(),
        };
        incomeClients.set(key, c);
      }
      return c;
    }

    function nameClient(key: string, name: string | null, rank: number) {
      const c = clientFor(key);
      if (name && rank > c.nameRank) {
        c.name = name;
        c.nameRank = rank;
      }
    }

    function addIncome(
      layer: "paid" | "invoiced" | "projected",
      key: string,
      monthKey: string,
      amount: number
    ) {
      const c = clientFor(key);
      c[layer].set(monthKey, (c[layer].get(monthKey) || 0) + amount);
    }

    function addTo(
      map: AccountMap,
      code: string,
      name: string,
      type: string,
      monthKey: string,
      amount: number
    ) {
      if (!map.has(code)) {
        map.set(code, { name, type, months: new Map() });
      }
      const acc = map.get(code)!;
      acc.months.set(monthKey, (acc.months.get(monthKey) || 0) + amount);
    }

    // signedCash orientation: positive = money in. Income-type lines route to
    // the UNASSIGNED income layers (paid when banked, invoiced when expected);
    // cost accounts store the negation (positive = money out), so a refund
    // reduces its own section instead of inflating the other.
    function addActual(
      code: string,
      name: string,
      type: string,
      monthKey: string,
      signedCash: number
    ) {
      if (INCOME_TYPES.has(type)) {
        addIncome("paid", "UNASSIGNED", monthKey, signedCash);
      } else {
        addTo(actualOut, code, name, type, monthKey, -signedCash);
      }
      actualMonthNet.set(
        monthKey,
        (actualMonthNet.get(monthKey) || 0) + signedCash
      );
    }

    function addProjected(
      code: string,
      name: string,
      type: string,
      monthKey: string,
      signedCash: number
    ) {
      if (INCOME_TYPES.has(type)) {
        // Post-dated receipts and bill income lines are expected cash: they
        // sit with the promises, not the banked money (R18).
        addIncome("invoiced", "UNASSIGNED", monthKey, signedCash);
      } else {
        addTo(projectedOut, code, name, type, monthKey, -signedCash);
      }
    }

    // Spread a document's cash across its line items — scaled so the shares
    // sum to the tax-inclusive amount that actually moves (line amounts are
    // tax-exclusive) — or into UNCATEGORISED when there are no usable lines.
    // BANK-account lines are transfer legs between own accounts: no net cash.
    function distribute(
      add: typeof addActual,
      monthKey: string,
      dir: 1 | -1,
      amount: number,
      lineItems: LineItem[]
    ) {
      const sum = lineItems.reduce((s, li) => s + li.LineAmount, 0);
      // Epsilon, not !== 0: lines cancelling to float noise must not divide
      if (lineItems.length > 0 && Math.abs(sum) > 0.005) {
        for (const li of lineItems) {
          const acc = accountLookup.get(li.AccountCode);
          if (acc?.type === "BANK") continue;
          const cash = dir * amount * (li.LineAmount / sum);
          if (acc) {
            add(li.AccountCode, acc.name, acc.type, monthKey, cash);
          } else {
            add(
              "UNCATEGORISED",
              "Uncategorised",
              dir > 0 ? "REVENUE" : "EXPENSE",
              monthKey,
              cash
            );
          }
        }
      } else {
        add(
          "UNCATEGORISED",
          "Uncategorised",
          dir > 0 ? "REVENUE" : "EXPENSE",
          monthKey,
          dir * amount
        );
      }
    }

    // Post-dated cash has not hit the bank yet: treat it as expected, not
    // banked. `now` above is startOfMonth, so take today's date afresh.
    const today = format(new Date(), "yyyy-MM-dd");

    // Bank transactions (spend/receive money). Income-type lines land in the
    // UNASSIGNED paid layer via addActual; everything else stays account-based.
    for (const txn of bankTxns) {
      const status = (txn.status as string) || "";
      const type = (txn.type as string) || "";
      if (status === "DELETED") continue;
      // Transfers between own accounts move no net cash
      if (type.endsWith("-TRANSFER")) continue;
      const dir = type.startsWith("RECEIVE") ? 1 : -1;
      const monthKey = (txn.date as string).slice(0, 7);
      const lineItems = (txn.line_items as LineItem[] | null) || [];
      const add = (txn.date as string) > today ? addProjected : addActual;
      distribute(add, monthKey, dir, Number(txn.total) || 0, lineItems);
    }

    // Invoice payments. ACCREC payments are whole-document income under their
    // client (R13) — their line-level shares never touch the costs pass.
    // ACCPAY payments keep the line-item attribution on cost accounts.
    for (const p of payments) {
      if ((p.status as string) === "DELETED") continue;
      const monthKey = (p.date as string).slice(0, 7);
      const inv = invoiceById.get(p.invoice_xero_id as string);
      const dir =
        p.payment_type === "ACCRECPAYMENT"
          ? 1
          : p.payment_type === "ACCPAYPAYMENT"
            ? -1
            : inv?.type === "ACCREC"
              ? 1
              : inv?.type === "ACCPAY"
                ? -1
                  : 0;
      if (dir === 0) continue; // direction unknowable; never guess with money
      const amount = Number(p.amount) || 0;
      const postDated = (p.date as string) > today;

      if (dir === 1) {
        const key = clientKey(
          (inv?.contact_id as string | null) ?? null,
          (inv?.contact_name as string | null) ?? null
        );
        nameClient(key, (inv?.contact_name as string | null) ?? null, 2);
        if (postDated) {
          addIncome("invoiced", key, monthKey, amount);
        } else {
          addIncome("paid", key, monthKey, amount);
          actualMonthNet.set(
            monthKey,
            (actualMonthNet.get(monthKey) || 0) + amount
          );
        }
      } else {
        const lineItems = (inv?.line_items as LineItem[] | null) || [];
        const add = postDated ? addProjected : addActual;
        distribute(add, monthKey, dir, amount, lineItems);
      }
    }

    // Unpaid ACCREC invoices: the invoiced layer, whole remaining amount under
    // their client, bucketed at expected/due date and floored to the current
    // month (overdue rolls forward and is flagged; the past is cash only).
    // Unpaid ACCPAY bills keep the account-based projected pass.
    for (const inv of openInvoices) {
      const status = inv.status as string;
      if (status !== "AUTHORISED" && status !== "SUBMITTED") continue;
      const remaining = Number(inv.amount_due) || 0;
      if (remaining === 0) continue;
      const rawDate =
        (inv.expected_payment_date as string | null) ||
        (inv.due_date as string | null);
      if (!rawDate) continue;
      let projMonth = rawDate.slice(0, 7);
      if (projMonth < currentMonth) projMonth = currentMonth;
      if (!months.includes(projMonth)) continue;

      if (inv.type === "ACCREC") {
        const key = clientKey(
          inv.contact_id as string | null,
          inv.contact_name as string | null
        );
        nameClient(key, inv.contact_name as string | null, 2);
        addIncome("invoiced", key, projMonth, remaining);
        if (rawDate < today) clientFor(key).overdue.add(projMonth);
      } else {
        const lineItems = (inv.line_items as LineItem[] | null) || [];
        distribute(addProjected, projMonth, -1, remaining, lineItems);
      }
    }

    // Projections: expand each into its monthly occurrences (recurrence +
    // escalation), then add every non-lapsed occurrence's remainder to the
    // projected layer at its own month, never floored (R18 — non-lapsed
    // implies current or later). Lapsed occurrences leave the optimistic layer
    // entirely and surface via /api/pipeline.
    const assignedByProjection = new Map<
      string,
      Array<{ status: string | null; total: number | string | null; bucketMonth: string | null }>
    >();
    for (const inv of assignedInvoices) {
      const pid = inv.projection_id as string;
      const list = assignedByProjection.get(pid) || [];
      list.push({
        status: inv.status as string | null,
        total: inv.total as number | null,
        bucketMonth: invoiceBucketMonth(
          inv.expected_payment_date as string | null,
          inv.due_date as string | null,
          currentMonth
        ),
      });
      assignedByProjection.set(pid, list);
    }

    for (const proj of projections as ProjectionRow[]) {
      const { occurrences } = expandProjection(
        proj,
        assignedByProjection.get(proj.id) || [],
        currentMonth
      );
      const key = clientKey(proj.contact_id, proj.client_label);
      let named = false;
      for (const occ of occurrences) {
        if (occ.lapsed || occ.remainder <= 0) continue;
        if (!months.includes(occ.month)) continue;
        if (!named) {
          nameClient(key, (proj.client_label || "").trim().replace(/\s+/g, " ") || null, 1);
          named = true;
        }
        addIncome("projected", key, occ.month, occ.remainder);
      }
    }

    // The last 3 calendar months before the current one, independent of the
    // visible window (cash was fetched at least that far back)
    const avgMonths: string[] = [];
    for (let i = HISTORY_FOR_AVG; i >= 1; i--) {
      avgMonths.push(format(subMonths(now, i), "yyyy-MM"));
    }

    // Ensure cost accounts with current/future overrides appear even without
    // flows (income no longer reads overrides)
    for (const [code] of overrideLookup) {
      const acc = accountLookup.get(code);
      if (!acc || acc.type === "BANK" || INCOME_TYPES.has(acc.type)) continue;
      if (!actualOut.has(code)) {
        addTo(actualOut, code, acc.name, acc.type, "", 0);
      }
    }

    // Build per-account cost rows following the column semantics:
    //   past = actual cash only; current = cash so far + projected remainder;
    //   future = bill data (wins by presence), else override, else the
    //   3-month average
    function buildCostAccounts(): CashflowAccount[] {
      const codes = new Set([...actualOut.keys(), ...projectedOut.keys()]);
      const accounts: CashflowAccount[] = [];

      for (const code of codes) {
        const data = actualOut.get(code) || projectedOut.get(code)!;
        const actual = actualOut.get(code)?.months;
        const projected = projectedOut.get(code)?.months;
        const accountOverrides = overrideLookup.get(code);

        const avgValues = avgMonths.map((m) => actual?.get(m) || 0);
        const avg = avgValues.reduce((a, b) => a + b, 0) / avgMonths.length;

        const monthly: number[] = [];
        const isProjected: boolean[] = [];
        const hasOverride: boolean[] = [];

        for (let i = 0; i < months.length; i++) {
          const m = months[i];
          const act = actual?.get(m);
          const proj = projected?.get(m);
          const ovr = accountOverrides?.get(m);

          if (i < currentMonthIndex) {
            monthly.push(round(act || 0));
            isProjected.push(false);
            hasOverride.push(false);
          } else if (i === currentMonthIndex) {
            const cashMTD = act || 0;
            let remainder = 0;
            if (proj !== undefined) {
              remainder = proj;
            } else if (ovr !== undefined) {
              remainder = Math.max(0, ovr - cashMTD);
            } else if (avg > cashMTD) {
              remainder = avg - cashMTD;
            }
            monthly.push(round(cashMTD + remainder));
            isProjected.push(round(remainder) !== 0);
            hasOverride.push(ovr !== undefined);
          } else {
            if (proj !== undefined) {
              monthly.push(round(proj));
              hasOverride.push(false);
            } else if (ovr !== undefined) {
              monthly.push(round(ovr));
              hasOverride.push(true);
            } else {
              monthly.push(round(avg));
              hasOverride.push(false);
            }
            isProjected.push(true);
          }
        }

        // Stale past-month overrides must not create phantom all-zero rows
        const hasLiveOverride = accountOverrides
          ? [...accountOverrides.keys()].some(
              (m) => m >= currentMonth && months.includes(m)
            )
          : false;

        if (monthly.some((v) => v !== 0) || hasLiveOverride) {
          accounts.push({
            accountCode: code,
            accountName: data.name,
            monthly,
            isProjected,
            hasOverride,
          });
        }
      }

      accounts.sort(
        (a, b) =>
          b.monthly.reduce((s, v) => s + v, 0) -
          a.monthly.reduce((s, v) => s + v, 0)
      );

      return accounts;
    }

    // Build the income section: client rows with per-layer series and the
    // section's per-layer totals. Hidden accounts do not apply to income.
    function buildIncome(): {
      clients: IncomeClient[];
      totals: { paid: number[]; invoiced: number[]; projected: number[] };
    } {
      const clients: IncomeClient[] = [];
      const totals = {
        paid: new Array(months.length).fill(0) as number[],
        invoiced: new Array(months.length).fill(0) as number[],
        projected: new Array(months.length).fill(0) as number[],
      };

      for (const [key, data] of incomeClients) {
        const paid: number[] = [];
        const invoiced: number[] = [];
        const projected: number[] = [];
        const monthly: number[] = [];
        const overdue: boolean[] = [];

        for (let i = 0; i < months.length; i++) {
          const m = months[i];
          const p = round(data.paid.get(m) || 0);
          const inv = round(data.invoiced.get(m) || 0);
          const proj = round(data.projected.get(m) || 0);
          paid.push(p);
          invoiced.push(inv);
          projected.push(proj);
          monthly.push(round(p + inv + proj));
          overdue.push(data.overdue.has(m));
          totals.paid[i] = round(totals.paid[i] + p);
          totals.invoiced[i] = round(totals.invoiced[i] + inv);
          totals.projected[i] = round(totals.projected[i] + proj);
        }

        if (monthly.some((v) => v !== 0)) {
          clients.push({
            clientKey: key,
            clientName: data.name || "Unknown",
            monthly,
            paid,
            invoiced,
            projected,
            overdue,
          });
        }
      }

      clients.sort(
        (a, b) =>
          b.monthly.reduce((s, v) => s + v, 0) -
          a.monthly.reduce((s, v) => s + v, 0)
      );

      return { clients, totals };
    }

    const allCashOut = buildCostAccounts();
    const income = buildIncome();

    // Committed = cash + invoices sent + the costs section's forecasts; the
    // headline never includes hope. Optimistic adds unfulfilled projection
    // remainders (R9/R10).
    const committedNet: number[] = new Array(months.length).fill(0);
    const optimisticNet: number[] = new Array(months.length).fill(0);
    for (let i = 0; i < months.length; i++) {
      const outflows = allCashOut.reduce((s, a) => s + a.monthly[i], 0);
      committedNet[i] = round(
        income.totals.paid[i] + income.totals.invoiced[i] - outflows
      );
      optimisticNet[i] = round(committedNet[i] + income.totals.projected[i]);
    }

    const cashOut = allCashOut.filter((a) => !hiddenCodes.has(a.accountCode));

    // Balance walks, anchored on the actual bank balance today:
    //   current closing = today + committed remainder (a projected month-end)
    //   previous closing = today - cash so far this month
    //   history walks backwards on cash-only nets; the future walks forward.
    // The optimistic walk shares the identical history and diverges from the
    // current month by the cumulative projected remainders.
    const committedClosing: number[] = new Array(months.length).fill(0);
    const committedOpening: number[] = new Array(months.length).fill(0);
    const optimisticClosing: number[] = new Array(months.length).fill(0);

    const cashMTDNet = actualMonthNet.get(currentMonth) || 0;
    committedClosing[currentMonthIndex] = round(
      currentBalance + (committedNet[currentMonthIndex] - cashMTDNet)
    );
    if (currentMonthIndex > 0) {
      committedClosing[currentMonthIndex - 1] = round(
        currentBalance - cashMTDNet
      );
      for (let i = currentMonthIndex - 2; i >= 0; i--) {
        committedClosing[i] = round(
          committedClosing[i + 1] - committedNet[i + 1]
        );
      }
    }
    for (let i = currentMonthIndex + 1; i < months.length; i++) {
      committedClosing[i] = round(committedClosing[i - 1] + committedNet[i]);
    }
    for (let i = 0; i < months.length; i++) {
      committedOpening[i] =
        i === 0
          ? round(committedClosing[0] - committedNet[0])
          : committedClosing[i - 1];
    }

    let projectedCumulative = 0;
    for (let i = 0; i < months.length; i++) {
      if (i < currentMonthIndex) {
        optimisticClosing[i] = committedClosing[i];
      } else {
        projectedCumulative += income.totals.projected[i];
        optimisticClosing[i] = round(committedClosing[i] + projectedCumulative);
      }
    }

    // "Falls below £0 in" — format is string-matched by the web app
    function fallsBelow(series: number[]): string | null {
      for (let i = currentMonthIndex; i < series.length; i++) {
        if (series[i] < 0) {
          const monthsUntil = i - currentMonthIndex;
          if (monthsUntil === 0) return "This month";
          if (monthsUntil === 1) return "1 month";
          return `${monthsUntil} months`;
        }
      }
      return null;
    }

    // Accounts info list (P&L accounts with hidden status; bank accounts are
    // not part of the grid). Income hiding no longer affects the income
    // section but the flag is kept for the management panel.
    const accounts: CashflowAccountInfo[] = chartAccounts
      .filter((a) => a.code && a.type !== "BANK")
      .map((a) => ({
        code: a.code,
        name: a.name,
        type: a.type,
        section: INCOME_TYPES.has(a.type)
          ? ("income" as const)
          : ("costs" as const),
        hidden: hiddenCodes.has(a.code),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const response: CashflowResponse = {
      currentBalance: round(currentBalance),
      fallsBelowZeroIn: fallsBelow(committedClosing),
      optimisticFallsBelowZeroIn: fallsBelow(optimisticClosing),
      currentMonthIndex,
      months,
      income,
      cashOut,
      committedOpening,
      committedClosing,
      committedNet,
      optimisticClosing,
      optimisticNet,
      accounts,
    };

    return json(response);
  } catch (err) {
    return handleError(err);
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
