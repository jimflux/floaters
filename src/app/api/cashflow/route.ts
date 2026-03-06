import { requireConnection, json, handleError } from "@/lib/api-helpers";
import { supabase } from "@/lib/supabase";
import { NextRequest } from "next/server";
import { format, addMonths, subMonths, startOfMonth } from "date-fns";
import type { CashflowResponse, CashflowAccount } from "@/types/api";

export async function GET(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const { searchParams } = new URL(request.url);

    const monthsBack = parseInt(searchParams.get("back") || "6", 10);
    const monthsForward = parseInt(searchParams.get("forward") || "6", 10);
    const historyForAvg = 3; // average last 3 months for projections

    const now = startOfMonth(new Date());
    const from = subMonths(now, monthsBack);
    const to = addMonths(now, monthsForward);

    // Build list of month keys
    const months: string[] = [];
    let cursor = from;
    while (cursor < to) {
      months.push(format(cursor, "yyyy-MM"));
      cursor = addMonths(cursor, 1);
    }

    const currentMonthIdx = months.indexOf(format(now, "yyyy-MM"));

    // Fetch bank transactions (historical actuals)
    const { data: bankTxns } = await supabase
      .from("xero_bank_transactions")
      .select("type, account_code, account_name, total, date, contact_name")
      .eq("connection_id", connectionId)
      .gte("date", format(from, "yyyy-MM-dd"))
      .order("date", { ascending: true });

    // Fetch outstanding invoices (future expected)
    const { data: invoices } = await supabase
      .from("xero_invoices")
      .select("type, contact_name, total, amount_due, due_date, status")
      .eq("connection_id", connectionId)
      .in("status", ["AUTHORISED", "SUBMITTED", "DRAFT"]);

    // Fetch bank account balances for opening
    const { data: bankAccounts } = await supabase
      .from("xero_accounts")
      .select("current_balance")
      .eq("connection_id", connectionId)
      .eq("type", "BANK");

    const currentBalance = (bankAccounts || []).reduce(
      (sum, a) => sum + (Number(a.current_balance) || 0),
      0
    );

    // Group bank transactions by account and month
    type AccountMonthMap = Map<string, { name: string; months: Map<string, number> }>;
    const cashInMap: AccountMonthMap = new Map();
    const cashOutMap: AccountMonthMap = new Map();

    for (const txn of bankTxns || []) {
      const monthKey = (txn.date as string).slice(0, 7);
      if (!months.includes(monthKey)) continue;

      const isInflow = txn.type === "RECEIVE";
      const map = isInflow ? cashInMap : cashOutMap;
      const code = txn.account_code || txn.account_name || "Unknown";
      const name = txn.account_name || txn.account_code || "Unknown";

      if (!map.has(code)) {
        map.set(code, { name, months: new Map() });
      }
      const acc = map.get(code)!;
      acc.months.set(monthKey, (acc.months.get(monthKey) || 0) + Number(txn.total));
    }

    // Add outstanding invoices to future months
    for (const inv of invoices || []) {
      if (!inv.due_date) continue;
      const monthKey = (inv.due_date as string).slice(0, 7);
      if (!months.includes(monthKey)) continue;

      const isInflow = inv.type === "ACCREC";
      const map = isInflow ? cashInMap : cashOutMap;
      const code = inv.contact_name || "Other";
      const name = inv.contact_name || "Other";

      if (!map.has(code)) {
        map.set(code, { name, months: new Map() });
      }
      const acc = map.get(code)!;
      acc.months.set(monthKey, (acc.months.get(monthKey) || 0) + Number(inv.amount_due));
    }

    // Convert maps to arrays and compute projections
    function buildAccounts(map: AccountMonthMap): CashflowAccount[] {
      const accounts: CashflowAccount[] = [];

      for (const [code, data] of map) {
        const monthly: number[] = [];
        const isProjected: boolean[] = [];

        // Compute 3-month average from historical data for projections
        const historicalMonths = months.slice(
          Math.max(0, currentMonthIdx - historyForAvg),
          currentMonthIdx
        );
        const historicalValues = historicalMonths.map((m) => data.months.get(m) || 0);
        const avg =
          historicalValues.length > 0
            ? historicalValues.reduce((a, b) => a + b, 0) / historicalValues.length
            : 0;

        for (let i = 0; i < months.length; i++) {
          const actual = data.months.get(months[i]);
          if (i < currentMonthIdx) {
            // Historical
            monthly.push(Math.round((actual || 0) * 100) / 100);
            isProjected.push(false);
          } else if (actual !== undefined) {
            // Current/future with known data (invoices)
            monthly.push(Math.round(actual * 100) / 100);
            isProjected.push(i > currentMonthIdx);
          } else {
            // Future projection based on average
            monthly.push(Math.round(avg * 100) / 100);
            isProjected.push(true);
          }
        }

        // Only include accounts that have at least some activity
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

    const cashIn = buildAccounts(cashInMap);
    const cashOut = buildAccounts(cashOutMap);

    // Compute opening/closing balances per month
    const openingBalance: number[] = [];
    const closingBalance: number[] = [];

    let balance = currentBalance;
    // Work backwards from current month to compute historical opening balances
    const historicalBalances: number[] = new Array(months.length).fill(0);
    historicalBalances[currentMonthIdx] = currentBalance;

    // Go backwards
    for (let i = currentMonthIdx - 1; i >= 0; i--) {
      const monthInflows = cashIn.reduce((s, a) => s + a.monthly[i + 1], 0);
      const monthOutflows = cashOut.reduce((s, a) => s + a.monthly[i + 1], 0);
      historicalBalances[i] = historicalBalances[i + 1] - monthInflows + monthOutflows;
    }

    // Go forwards from current month
    for (let i = currentMonthIdx + 1; i < months.length; i++) {
      const monthInflows = cashIn.reduce((s, a) => s + a.monthly[i], 0);
      const monthOutflows = cashOut.reduce((s, a) => s + a.monthly[i], 0);
      historicalBalances[i] = historicalBalances[i - 1] + monthInflows - monthOutflows;
    }

    for (let i = 0; i < months.length; i++) {
      if (i === 0) {
        openingBalance.push(Math.round(historicalBalances[i] * 100) / 100);
      } else {
        openingBalance.push(Math.round(historicalBalances[i - 1] * 100) / 100);
      }
      closingBalance.push(Math.round(historicalBalances[i] * 100) / 100);
    }

    const response: CashflowResponse = {
      months,
      cashIn,
      cashOut,
      openingBalance,
      closingBalance,
    };

    return json(response);
  } catch (err) {
    return handleError(err);
  }
}
