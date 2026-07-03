import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { supabase } from "@/lib/supabase";
import { NextRequest } from "next/server";
import { format, addMonths, subMonths, startOfMonth } from "date-fns";
import { z } from "zod/v4";
import { HISTORY_MONTHS } from "@/lib/xero/sync";
import type {
  CashflowResponse,
  CashflowAccount,
  CashflowAccountInfo,
} from "@/types/api";

const INCOME_TYPES = new Set(["REVENUE", "SALES"]);
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

// Prorate a document's line items so their contributions sum to the cash that
// actually moves (line amounts are tax-exclusive; totals are tax-inclusive).
function lineShares(lineItems: LineItem[]): { sum: number } {
  return { sum: lineItems.reduce((s, li) => s + li.LineAmount, 0) };
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
          "type, total, amount_due, due_date, expected_payment_date, status, line_items"
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
    ]);

    const bankTxns = bankTxnResult.data || [];
    const payments = paymentResult.data || [];
    const invoices = invoiceResult.data || [];
    const bankAccounts = bankAccountResult.data || [];
    const chartAccounts = accountsResult.data || [];
    const hiddenCodes = new Set(
      (hiddenResult.data || []).map((r) => r.account_code)
    );

    // Payments attribute to accounts via their invoice's line items. Those
    // invoices are often PAID (excluded from the projection query above), so
    // fetch them separately by id, any status.
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
              .select("xero_id, type, total, line_items")
              .eq("connection_id", connectionId)
              .in("xero_id", paymentInvoiceIds)
          ).data || []
        : [];
    const invoiceById = new Map(
      attributionInvoices.map((inv) => [inv.xero_id as string, inv])
    );

    // Build override lookup: accountCode -> month -> amount
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

    function getSection(accType: string): "income" | "costs" {
      return INCOME_TYPES.has(accType) ? "income" : "costs";
    }

    // Two accumulations per section: actual cash (bank txns + payments) and
    // projected cash (unpaid invoices). Keeping them separate is what lets
    // history stay pure cash while the current month blends.
    type MonthTotals = Map<string, number>;
    type AccountData = { name: string; type: string; months: MonthTotals };
    type AccountMap = Map<string, AccountData>;

    const actualIn: AccountMap = new Map();
    const actualOut: AccountMap = new Map();
    const projectedIn: AccountMap = new Map();
    const projectedOut: AccountMap = new Map();
    // Net actual cash per month (in minus out) across ALL accounts; drives
    // the balance anchor split for the current month
    const actualMonthNet = new Map<string, number>();

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

    // signedCash orientation: positive = money in. Income accounts store it
    // as-is; cost accounts store the negation (positive = money out), so a
    // refund reduces its own section instead of inflating the other.
    function addActual(
      code: string,
      name: string,
      type: string,
      monthKey: string,
      signedCash: number
    ) {
      const section = getSection(type);
      if (section === "income") {
        addTo(actualIn, code, name, type, monthKey, signedCash);
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
      const section = getSection(type);
      if (section === "income") {
        addTo(projectedIn, code, name, type, monthKey, signedCash);
      } else {
        addTo(projectedOut, code, name, type, monthKey, -signedCash);
      }
    }

    // Actual cash: bank transactions (spend/receive money)
    for (const txn of bankTxns) {
      const status = (txn.status as string) || "";
      const type = (txn.type as string) || "";
      if (status === "DELETED") continue;
      // Transfers between own accounts move no net cash
      if (type.endsWith("-TRANSFER")) continue;
      const dir = type.startsWith("RECEIVE") ? 1 : -1;
      const monthKey = (txn.date as string).slice(0, 7);
      const total = Number(txn.total) || 0;
      const lineItems = (txn.line_items as LineItem[] | null) || [];
      const { sum } = lineShares(lineItems);

      if (lineItems.length > 0 && sum !== 0) {
        const factor = total / sum;
        for (const li of lineItems) {
          const acc = accountLookup.get(li.AccountCode);
          if (acc?.type === "BANK") continue; // transfer leg
          const cash = dir * li.LineAmount * factor;
          if (acc) {
            addActual(li.AccountCode, acc.name, acc.type, monthKey, cash);
          } else {
            addActual(
              "UNCATEGORISED",
              "Uncategorised",
              dir > 0 ? "REVENUE" : "EXPENSE",
              monthKey,
              cash
            );
          }
        }
      } else {
        addActual(
          "UNCATEGORISED",
          "Uncategorised",
          dir > 0 ? "REVENUE" : "EXPENSE",
          monthKey,
          dir * total
        );
      }
    }

    // Actual cash: invoice payments, attributed via the invoice's line items
    for (const p of payments) {
      if ((p.status as string) === "DELETED") continue;
      const monthKey = (p.date as string).slice(0, 7);
      const amount = Number(p.amount) || 0;
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

      const lineItems = (inv?.line_items as LineItem[] | null) || [];
      const { sum } = lineShares(lineItems);
      if (lineItems.length > 0 && sum !== 0) {
        for (const li of lineItems) {
          const acc = accountLookup.get(li.AccountCode);
          if (acc?.type === "BANK") continue;
          const cash = dir * amount * (li.LineAmount / sum);
          if (acc) {
            addActual(li.AccountCode, acc.name, acc.type, monthKey, cash);
          } else {
            addActual(
              "UNCATEGORISED",
              "Uncategorised",
              dir > 0 ? "REVENUE" : "EXPENSE",
              monthKey,
              cash
            );
          }
        }
      } else {
        addActual(
          "UNCATEGORISED",
          "Uncategorised",
          dir > 0 ? "REVENUE" : "EXPENSE",
          monthKey,
          dir * amount
        );
      }
    }

    // Projected cash: unpaid invoices at their remaining amount, bucketed at
    // expected/due date and floored to the current month (overdue rolls
    // forward; the past is cash only)
    for (const inv of invoices) {
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

      const dir = inv.type === "ACCREC" ? 1 : -1;
      const lineItems = (inv.line_items as LineItem[] | null) || [];
      const { sum } = lineShares(lineItems);
      if (lineItems.length > 0 && sum !== 0) {
        for (const li of lineItems) {
          const acc = accountLookup.get(li.AccountCode);
          if (acc?.type === "BANK") continue;
          const cash = dir * remaining * (li.LineAmount / sum);
          if (acc) {
            addProjected(li.AccountCode, acc.name, acc.type, projMonth, cash);
          } else {
            addProjected(
              "UNCATEGORISED",
              "Uncategorised",
              dir > 0 ? "REVENUE" : "EXPENSE",
              projMonth,
              cash
            );
          }
        }
      } else {
        addProjected(
          "UNCATEGORISED",
          "Uncategorised",
          dir > 0 ? "REVENUE" : "EXPENSE",
          projMonth,
          dir * remaining
        );
      }
    }

    // The last 3 calendar months before the current one, independent of the
    // visible window (cash was fetched at least that far back)
    const avgMonths: string[] = [];
    for (let i = HISTORY_FOR_AVG; i >= 1; i--) {
      avgMonths.push(format(subMonths(now, i), "yyyy-MM"));
    }

    // Ensure accounts with current/future overrides appear even without flows
    for (const [code] of overrideLookup) {
      const acc = accountLookup.get(code);
      if (!acc || acc.type === "BANK") continue;
      const section = getSection(acc.type);
      const actualMap = section === "income" ? actualIn : actualOut;
      if (!actualMap.has(code)) {
        addTo(actualMap, code, acc.name, acc.type, "", 0);
      }
    }

    // Build per-account rows following the column semantics:
    //   past = actual cash only; current = cash so far + projected remainder;
    //   future = invoice data (wins by presence), else override, else the
    //   3-month average for costs
    function buildAccounts(
      actualMap: AccountMap,
      projectedMap: AccountMap,
      section: "income" | "costs"
    ): CashflowAccount[] {
      const codes = new Set([...actualMap.keys(), ...projectedMap.keys()]);
      const accounts: CashflowAccount[] = [];

      for (const code of codes) {
        const data = actualMap.get(code) || projectedMap.get(code)!;
        const actual = actualMap.get(code)?.months;
        const projected = projectedMap.get(code)?.months;
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
            } else if (section === "costs" && avg > cashMTD) {
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
            } else if (section === "costs") {
              monthly.push(round(avg));
              hasOverride.push(false);
            } else {
              monthly.push(0);
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

    // Full lists include hidden accounts: their cash moved, so they stay in
    // the nets and balances; only their rows are filtered from the response
    const allCashIn = buildAccounts(actualIn, projectedIn, "income");
    const allCashOut = buildAccounts(actualOut, projectedOut, "costs");

    const netCashMovement: number[] = new Array(months.length).fill(0);
    for (let i = 0; i < months.length; i++) {
      const inflows = allCashIn.reduce((s, a) => s + a.monthly[i], 0);
      const outflows = allCashOut.reduce((s, a) => s + a.monthly[i], 0);
      netCashMovement[i] = round(inflows - outflows);
    }

    const cashIn = allCashIn.filter((a) => !hiddenCodes.has(a.accountCode));
    const cashOut = allCashOut.filter((a) => !hiddenCodes.has(a.accountCode));

    // Balance walk, anchored on the actual bank balance today:
    //   current closing = today + projected remainder (a projected month-end)
    //   previous closing = today - cash so far this month
    //   history walks backwards on cash-only nets; the future walks forward
    const closingBalance: number[] = new Array(months.length).fill(0);
    const openingBalance: number[] = new Array(months.length).fill(0);

    const cashMTDNet = actualMonthNet.get(currentMonth) || 0;
    closingBalance[currentMonthIndex] = round(
      currentBalance + (netCashMovement[currentMonthIndex] - cashMTDNet)
    );
    if (currentMonthIndex > 0) {
      closingBalance[currentMonthIndex - 1] = round(
        currentBalance - cashMTDNet
      );
      for (let i = currentMonthIndex - 2; i >= 0; i--) {
        closingBalance[i] = round(
          closingBalance[i + 1] - netCashMovement[i + 1]
        );
      }
    }
    for (let i = currentMonthIndex + 1; i < months.length; i++) {
      closingBalance[i] = round(closingBalance[i - 1] + netCashMovement[i]);
    }
    for (let i = 0; i < months.length; i++) {
      openingBalance[i] =
        i === 0
          ? round(closingBalance[0] - netCashMovement[0])
          : closingBalance[i - 1];
    }

    // "Falls below £0 in" — format is string-matched by the web app
    let fallsBelowZeroIn: string | null = null;
    for (let i = currentMonthIndex; i < months.length; i++) {
      if (closingBalance[i] < 0) {
        const monthsUntil = i - currentMonthIndex;
        if (monthsUntil === 0) fallsBelowZeroIn = "This month";
        else if (monthsUntil === 1) fallsBelowZeroIn = "1 month";
        else fallsBelowZeroIn = `${monthsUntil} months`;
        break;
      }
    }

    // Accounts info list (P&L accounts with hidden status; bank accounts are
    // not part of the income/costs grid)
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
      fallsBelowZeroIn,
      currentMonthIndex,
      months,
      cashIn,
      cashOut,
      openingBalance,
      closingBalance,
      netCashMovement,
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
