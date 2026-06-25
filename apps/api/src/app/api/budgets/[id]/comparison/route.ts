import { supabase } from "@/lib/supabase";
import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import {
  startOfMonth,
  endOfMonth,
  format,
  parseISO,
  eachMonthOfInterval,
} from "date-fns";
import type { BudgetComparisonResponse } from "@/types/api";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const connectionId = await requireConnection();
    const { id } = await params;

    // Get budget with lines
    const { data: budget } = await supabase
      .from("budgets")
      .select("*, budget_lines(*)")
      .eq("id", id)
      .eq("connection_id", connectionId)
      .single();

    if (!budget) return error("Budget not found", 404);

    const lines = budget.budget_lines || [];
    if (lines.length === 0) {
      return json({ periods: [] } as BudgetComparisonResponse);
    }

    // Determine date range from budget lines
    const periodStarts = lines.map((l: { period_start: string }) =>
      parseISO(l.period_start)
    );
    const minDate = startOfMonth(
      new Date(Math.min(...periodStarts.map((d: Date) => d.getTime())))
    );
    const maxDate = endOfMonth(
      new Date(Math.max(...periodStarts.map((d: Date) => d.getTime())))
    );

    // Get actual bank transactions for the same period
    const { data: transactions } = await supabase
      .from("xero_bank_transactions")
      .select("*")
      .eq("connection_id", connectionId)
      .gte("date", format(minDate, "yyyy-MM-dd"))
      .lte("date", format(maxDate, "yyyy-MM-dd"));

    // Build comparison per month
    const months = eachMonthOfInterval({ start: minDate, end: maxDate });
    const periods: BudgetComparisonResponse["periods"] = [];

    for (const month of months) {
      const monthStart = format(startOfMonth(month), "yyyy-MM-dd");
      const monthEnd = format(endOfMonth(month), "yyyy-MM-dd");

      // Get budget lines for this month
      const monthLines = lines.filter(
        (l: { period_start: string }) => l.period_start === monthStart
      );

      // Get categories from budget lines
      const categories = new Map<
        string,
        { type: "income" | "expense"; budgeted: number }
      >();
      for (const line of monthLines) {
        categories.set(line.category, {
          type: line.type,
          budgeted: Number(line.amount),
        });
      }

      // Calculate actuals from bank transactions
      const monthTxns = (transactions || []).filter(
        (t) => t.date >= monthStart && t.date <= monthEnd
      );

      const categoryResults = Array.from(categories.entries()).map(
        ([category, { type, budgeted }]) => {
          // Sum actual transactions matching this category (by account_name)
          const actual = monthTxns
            .filter((t) => {
              const isMatchingType =
                (type === "income" && t.type === "RECEIVE") ||
                (type === "expense" && t.type === "SPEND");
              return (
                isMatchingType &&
                (t.account_name === category || t.account_code === category)
              );
            })
            .reduce((sum, t) => sum + Number(t.total), 0);

          const variance = budgeted - actual;
          const variancePercent =
            budgeted > 0 ? (variance / budgeted) * 100 : 0;

          return {
            category,
            type,
            budgeted: Math.round(budgeted * 100) / 100,
            actual: Math.round(actual * 100) / 100,
            variance: Math.round(variance * 100) / 100,
            variancePercent: Math.round(variancePercent * 10) / 10,
          };
        }
      );

      periods.push({
        periodStart: monthStart,
        categories: categoryResults,
      });
    }

    return json({ periods } as BudgetComparisonResponse);
  } catch (err) {
    return handleError(err);
  }
}
