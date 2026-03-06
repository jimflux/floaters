import { requireConnection, json, handleError } from "@/lib/api-helpers";
import { supabase } from "@/lib/supabase";
import { NextRequest } from "next/server";
import {
  format,
  addMonths,
  subMonths,
  startOfMonth,
  differenceInMonths,
} from "date-fns";
import type { CashflowResponse, CashflowAccount } from "@/types/api";

export async function GET(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const { searchParams } = new URL(request.url);

    const monthsBack = parseInt(searchParams.get("back") || "3", 10);
    const monthsForward = parseInt(searchParams.get("forward") || "12", 10);
    const historyForAvg = 3;

    const now = startOfMonth(new Date());
    const from = subMonths(now, monthsBack);
    const to = addMonths(now, monthsForward);

    // Build month keys
    const months: string[] = [];
    let cursor = from;
    while (cursor < to) {
      months.push(format(cursor, "yyyy-MM"));
      cursor = addMonths(cursor, 1);
    }
    const currentMonthIndex = months.indexOf(format(now, "yyyy-MM"));

    // Fetch all data in parallel
    const [bankTxnResult, invoiceResult, bankAccountResult] = await Promise.all(
      [
        supabase
          .from("xero_bank_transactions")
          .select("type, account_code, account_name, total, date")
          .eq("connection_id", connectionId)
          .gte("date", format(from, "yyyy-MM-dd"))
          .order("date", { ascending: true }),
        supabase
          .from("xero_invoices")
          .select("type, contact_name, total, amount_due, due_date, status")
          .eq("connection_id", connectionId)
          .in("status", ["AUTHORISED", "SUBMITTED", "DRAFT"]),
        supabase
          .from("xero_accounts")
          .select("current_balance")
          .eq("connection_id", connectionId)
          .eq("type", "BANK"),
      ]
    );

    const bankTxns = bankTxnResult.data || [];
    const invoices = invoiceResult.data || [];
    const bankAccounts = bankAccountResult.data || [];

    const currentBalance = bankAccounts.reduce(
      (sum, a) => sum + (Number(a.current_balance) || 0),
      0
    );

    // Group bank transactions by account+month
    type MonthTotals = Map<string, number>;
    type AccountData = { name: string; months: MonthTotals };
    type AccountMap = Map<string, AccountData>;

    const cashInMap: AccountMap = new Map();
    const cashOutMap: AccountMap = new Map();

    for (const txn of bankTxns) {
      const monthKey = (txn.date as string).slice(0, 7);
      if (!months.includes(monthKey)) continue;

      const isInflow = txn.type === "RECEIVE";
      const map = isInflow ? cashInMap : cashOutMap;
      const code = txn.account_name || txn.account_code || "Other";

      if (!map.has(code)) {
        map.set(code, { name: code, months: new Map() });
      }
      const acc = map.get(code)!;
      acc.months.set(monthKey, (acc.months.get(monthKey) || 0) + Number(txn.total));
    }

    // Add outstanding invoices to Cash In (by due date)
    for (const inv of invoices) {
      if (!inv.due_date || inv.type !== "ACCREC") continue;
      const monthKey = (inv.due_date as string).slice(0, 7);
      if (!months.includes(monthKey)) continue;

      const name = inv.contact_name || "Other Income";
      if (!cashInMap.has(name)) {
        cashInMap.set(name, { name, months: new Map() });
      }
      const acc = cashInMap.get(name)!;
      acc.months.set(monthKey, (acc.months.get(monthKey) || 0) + Number(inv.amount_due));
    }

    // Add outstanding bills to Cash Out (by due date)
    for (const inv of invoices) {
      if (!inv.due_date || inv.type !== "ACCPAY") continue;
      const monthKey = (inv.due_date as string).slice(0, 7);
      if (!months.includes(monthKey)) continue;

      const name = inv.contact_name || "Other Costs";
      if (!cashOutMap.has(name)) {
        cashOutMap.set(name, { name, months: new Map() });
      }
      const acc = cashOutMap.get(name)!;
      acc.months.set(monthKey, (acc.months.get(monthKey) || 0) + Number(inv.amount_due));
    }

    // Build account arrays with projections
    function buildAccounts(
      map: AccountMap,
      projectionStyle: "invoice" | "average"
    ): CashflowAccount[] {
      const accounts: CashflowAccount[] = [];

      for (const [code, data] of map) {
        const monthly: number[] = [];
        const isProjected: boolean[] = [];

        // 3-month historical average for projections
        const avgMonths = months.slice(
          Math.max(0, currentMonthIndex - historyForAvg),
          currentMonthIndex
        );
        const avgValues = avgMonths.map((m) => data.months.get(m) || 0);
        const avg =
          avgValues.length > 0
            ? avgValues.reduce((a, b) => a + b, 0) / avgValues.length
            : 0;

        for (let i = 0; i < months.length; i++) {
          const actual = data.months.get(months[i]);

          if (i <= currentMonthIndex) {
            // Historical or current month — use actuals
            monthly.push(round(actual || 0));
            isProjected.push(false);
          } else if (actual !== undefined && actual > 0) {
            // Future month with known data (invoices/bills)
            monthly.push(round(actual));
            isProjected.push(true);
          } else if (projectionStyle === "average") {
            // Cash Out: always project from 3-month average
            monthly.push(round(avg));
            isProjected.push(true);
          } else {
            // Cash In: only show known invoices, no average fill
            monthly.push(round(actual || 0));
            isProjected.push(true);
          }
        }

        if (monthly.some((v) => v !== 0)) {
          accounts.push({
            accountCode: code,
            accountName: data.name,
            monthly,
            isProjected,
          });
        }
      }

      // Sort by total descending
      accounts.sort(
        (a, b) =>
          b.monthly.reduce((s, v) => s + v, 0) -
          a.monthly.reduce((s, v) => s + v, 0)
      );

      return accounts;
    }

    // Cash In: invoice-based projections. Cash Out: 3-month average projections.
    const cashIn = buildAccounts(cashInMap, "invoice");
    const cashOut = buildAccounts(cashOutMap, "average");

    // Compute balances and net cash movement
    const openingBalance: number[] = [];
    const closingBalance: number[] = [];
    const netCashMovement: number[] = [];

    const balances: number[] = new Array(months.length).fill(0);
    balances[currentMonthIndex] = currentBalance;

    // Work backwards for historical months
    for (let i = currentMonthIndex - 1; i >= 0; i--) {
      const inflows = cashIn.reduce((s, a) => s + a.monthly[i + 1], 0);
      const outflows = cashOut.reduce((s, a) => s + a.monthly[i + 1], 0);
      balances[i] = balances[i + 1] - inflows + outflows;
    }

    // Work forwards for projected months
    for (let i = currentMonthIndex + 1; i < months.length; i++) {
      const inflows = cashIn.reduce((s, a) => s + a.monthly[i], 0);
      const outflows = cashOut.reduce((s, a) => s + a.monthly[i], 0);
      balances[i] = balances[i - 1] + inflows - outflows;
    }

    for (let i = 0; i < months.length; i++) {
      const inflows = cashIn.reduce((s, a) => s + a.monthly[i], 0);
      const outflows = cashOut.reduce((s, a) => s + a.monthly[i], 0);
      openingBalance.push(round(i === 0 ? balances[0] - inflows + outflows : balances[i - 1]));
      closingBalance.push(round(balances[i]));
      netCashMovement.push(round(inflows - outflows));
    }

    // "Falls below £0 in" — find first future month where closing < 0
    let fallsBelowZeroIn: string | null = null;
    for (let i = currentMonthIndex; i < months.length; i++) {
      if (closingBalance[i] < 0) {
        const monthsUntil = i - currentMonthIndex;
        if (monthsUntil === 0) {
          fallsBelowZeroIn = "This month";
        } else if (monthsUntil === 1) {
          fallsBelowZeroIn = "1 month";
        } else {
          fallsBelowZeroIn = `${monthsUntil} months`;
        }
        break;
      }
    }
    // If we checked 12+ months and it never drops, say "2+ years" or null
    if (!fallsBelowZeroIn && monthsForward >= 24) {
      fallsBelowZeroIn = null; // never within range
    } else if (!fallsBelowZeroIn) {
      fallsBelowZeroIn = null;
    }

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
    };

    return json(response);
  } catch (err) {
    return handleError(err);
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
