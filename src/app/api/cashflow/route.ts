import { requireConnection, json, handleError } from "@/lib/api-helpers";
import { supabase } from "@/lib/supabase";
import { NextRequest } from "next/server";
import { format, addMonths, subMonths, startOfMonth, endOfMonth } from "date-fns";
import type {
  CashflowResponse,
  CashflowAccount,
  CashflowAccountInfo,
} from "@/types/api";

const INCOME_TYPES = new Set(["REVENUE", "SALES"]);
// Everything that isn't income goes into costs

interface LineItem {
  AccountCode: string;
  LineAmount: number;
  Description?: string;
}

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
    const [
      bankTxnResult,
      invoiceResult,
      bankAccountResult,
      accountsResult,
      hiddenResult,
      overrideResult,
    ] = await Promise.all([
      supabase
        .from("xero_bank_transactions")
        .select("type, total, date, line_items")
        .eq("connection_id", connectionId)
        .gte("date", format(from, "yyyy-MM-dd"))
        .order("date", { ascending: true }),
      supabase
        .from("xero_invoices")
        .select("type, total, amount_due, due_date, status, line_items")
        .eq("connection_id", connectionId)
        .in("status", ["AUTHORISED", "SUBMITTED", "DRAFT"]),
      supabase
        .from("xero_accounts")
        .select("current_balance")
        .eq("connection_id", connectionId)
        .eq("type", "BANK"),
      supabase
        .from("xero_accounts")
        .select("code, name, type")
        .eq("connection_id", connectionId)
        .neq("type", "BANK")
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
    const invoices = invoiceResult.data || [];
    const bankAccounts = bankAccountResult.data || [];
    const chartAccounts = accountsResult.data || [];
    const hiddenCodes = new Set(
      (hiddenResult.data || []).map((r) => r.account_code)
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

    // Build chart of accounts lookup
    const accountLookup = new Map<
      string,
      { name: string; type: string }
    >();
    for (const acc of chartAccounts) {
      if (acc.code) {
        accountLookup.set(acc.code, { name: acc.name, type: acc.type });
      }
    }

    // Determine section for an account type
    function getSection(
      accType: string
    ): "income" | "costs" {
      return INCOME_TYPES.has(accType) ? "income" : "costs";
    }

    // Group by account code + month
    type MonthTotals = Map<string, number>;
    type AccountData = { name: string; type: string; months: MonthTotals };
    type AccountMap = Map<string, AccountData>;

    const cashInMap: AccountMap = new Map();
    const cashOutMap: AccountMap = new Map();

    function addToMap(
      map: AccountMap,
      code: string,
      name: string,
      type: string,
      monthKey: string,
      amount: number
    ) {
      if (!months.includes(monthKey)) return;
      if (!map.has(code)) {
        map.set(code, { name, type, months: new Map() });
      }
      const acc = map.get(code)!;
      acc.months.set(
        monthKey,
        (acc.months.get(monthKey) || 0) + amount
      );
    }

    // Process bank transactions — use line items for account grouping
    for (const txn of bankTxns) {
      const monthKey = (txn.date as string).slice(0, 7);
      const lineItems = (txn.line_items as LineItem[] | null) || [];

      if (lineItems.length > 0) {
        for (const li of lineItems) {
          const acc = accountLookup.get(li.AccountCode);
          if (!acc) continue;
          const section = getSection(acc.type);
          const map = section === "income" ? cashInMap : cashOutMap;
          addToMap(
            map,
            li.AccountCode,
            acc.name,
            acc.type,
            monthKey,
            Math.abs(li.LineAmount)
          );
        }
      } else {
        // Fallback: no line items, use transaction type
        const isInflow = txn.type === "RECEIVE";
        const map = isInflow ? cashInMap : cashOutMap;
        addToMap(
          map,
          "UNCATEGORISED",
          "Uncategorised",
          isInflow ? "REVENUE" : "EXPENSE",
          monthKey,
          Number(txn.total)
        );
      }
    }

    // Process outstanding invoices — use line items for account grouping
    for (const inv of invoices) {
      if (!inv.due_date) continue;
      const monthKey = (inv.due_date as string).slice(0, 7);
      const lineItems = (inv.line_items as LineItem[] | null) || [];

      if (lineItems.length > 0) {
        for (const li of lineItems) {
          const acc = accountLookup.get(li.AccountCode);
          if (!acc) continue;
          const section = getSection(acc.type);
          const map = section === "income" ? cashInMap : cashOutMap;
          addToMap(
            map,
            li.AccountCode,
            acc.name,
            acc.type,
            monthKey,
            Math.abs(li.LineAmount)
          );
        }
      } else {
        // Fallback: use invoice type
        const isInflow = inv.type === "ACCREC";
        const map = isInflow ? cashInMap : cashOutMap;
        addToMap(
          map,
          "UNCATEGORISED",
          "Uncategorised",
          isInflow ? "REVENUE" : "EXPENSE",
          monthKey,
          Number(inv.amount_due)
        );
      }
    }

    // Build account arrays with projections, filtering out hidden accounts
    function buildAccounts(
      map: AccountMap,
      projectionStyle: "invoice" | "average"
    ): CashflowAccount[] {
      const accounts: CashflowAccount[] = [];

      for (const [code, data] of map) {
        if (hiddenCodes.has(code)) continue;

        const monthly: number[] = [];
        const isProjected: boolean[] = [];
        const hasOverride: boolean[] = [];
        const accountOverrides = overrideLookup.get(code);

        // 3-month historical average for cost projections
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
          const override = accountOverrides?.get(months[i]);

          if (i <= currentMonthIndex) {
            // Historical or current month — actual data only
            monthly.push(round(actual || 0));
            isProjected.push(false);
            hasOverride.push(false);
          } else if (actual !== undefined && actual > 0) {
            // Future month with known invoice data — invoice wins over override
            monthly.push(round(actual));
            isProjected.push(true);
            hasOverride.push(false);
          } else if (override !== undefined) {
            // Manual override when no invoice exists
            monthly.push(round(override));
            isProjected.push(true);
            hasOverride.push(true);
          } else if (projectionStyle === "average") {
            // Costs: project from 3-month average
            monthly.push(round(avg));
            isProjected.push(true);
            hasOverride.push(false);
          } else {
            // Income: only show known invoices
            monthly.push(round(actual || 0));
            isProjected.push(true);
            hasOverride.push(false);
          }
        }

        if (monthly.some((v) => v !== 0)) {
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

    const cashIn = buildAccounts(cashInMap, "invoice");
    const cashOut = buildAccounts(cashOutMap, "average");

    // Compute balances — actual data for past, projections for future
    // Anchor: currentBalance is the known bank balance RIGHT NOW (current month ending)
    const closingBalance: number[] = new Array(months.length).fill(0);
    const openingBalance: number[] = new Array(months.length).fill(0);
    const netCashMovement: number[] = new Array(months.length).fill(0);

    // Compute net cash movement per month
    for (let i = 0; i < months.length; i++) {
      const inflows = cashIn.reduce((s, a) => s + a.monthly[i], 0);
      const outflows = cashOut.reduce((s, a) => s + a.monthly[i], 0);
      netCashMovement[i] = round(inflows - outflows);
    }

    // Current month ending balance = actual bank balance
    closingBalance[currentMonthIndex] = round(currentBalance);

    // Historical months: work backwards using actual transaction flows
    // endingBalance[i] = endingBalance[i+1] - netCashMovement[i+1]
    for (let i = currentMonthIndex - 1; i >= 0; i--) {
      closingBalance[i] = round(
        closingBalance[i + 1] - netCashMovement[i + 1]
      );
    }

    // Future months: project forward
    for (let i = currentMonthIndex + 1; i < months.length; i++) {
      closingBalance[i] = round(
        closingBalance[i - 1] + netCashMovement[i]
      );
    }

    // Opening balance = previous month's closing (first month: closing - net)
    for (let i = 0; i < months.length; i++) {
      openingBalance[i] =
        i === 0
          ? round(closingBalance[0] - netCashMovement[0])
          : round(closingBalance[i - 1]);
    }

    // "Falls below £0 in"
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

    // Build accounts info list (all P&L accounts with hidden status)
    const accounts: CashflowAccountInfo[] = chartAccounts
      .filter((a) => a.code)
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
