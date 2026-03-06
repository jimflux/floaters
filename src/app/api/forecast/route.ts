import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { computeForecast } from "@/lib/forecast/engine";
import { supabase } from "@/lib/supabase";
import { NextRequest } from "next/server";
import {
  format,
  addMonths,
  addYears,
  differenceInMonths,
  differenceInDays,
  parseISO,
} from "date-fns";
import type { ForecastResponse } from "@/types/api";

export async function GET(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const { searchParams } = new URL(request.url);

    const period = (searchParams.get("period") || "weekly") as
      | "daily"
      | "weekly"
      | "monthly";
    const from =
      searchParams.get("from") || format(new Date(), "yyyy-MM-dd");
    const to =
      searchParams.get("to") ||
      format(addMonths(new Date(), 3), "yyyy-MM-dd");
    const scenarioParam = searchParams.get("scenarios");
    const scenarioIds = scenarioParam
      ? scenarioParam.split(",").filter(Boolean)
      : undefined;

    if (!["daily", "weekly", "monthly"].includes(period)) {
      return error("Invalid period. Use daily, weekly, or monthly.", 400);
    }

    // Current bank balance
    const { data: bankAccounts } = await supabase
      .from("xero_accounts")
      .select("current_balance")
      .eq("connection_id", connectionId)
      .eq("type", "BANK");

    const currentBalance = (bankAccounts || []).reduce(
      (sum, a) => sum + (Number(a.current_balance) || 0),
      0
    );

    // Compute the requested forecast periods
    const periods = await computeForecast(
      connectionId,
      period,
      from,
      to,
      scenarioIds
    );

    // Compute "falls below £0 in" — run a daily forecast out to 3 years
    const today = format(new Date(), "yyyy-MM-dd");
    const threeYearsOut = format(addYears(new Date(), 3), "yyyy-MM-dd");
    const dailyPeriods = await computeForecast(
      connectionId,
      "daily",
      today,
      threeYearsOut,
      scenarioIds
    );

    const zeroBreachPeriod = dailyPeriods.find((p) => p.closing < 0);
    let fallsBelowZeroIn: string | null = null;

    if (zeroBreachPeriod) {
      const breachDate = parseISO(zeroBreachPeriod.date);
      const now = new Date();
      const months = differenceInMonths(breachDate, now);
      const days = differenceInDays(breachDate, now);

      if (days < 30) {
        fallsBelowZeroIn = "< 1 month";
      } else if (months === 1) {
        fallsBelowZeroIn = "1 month";
      } else {
        fallsBelowZeroIn = `${months} months`;
      }
    }

    // Get threshold
    const { data: threshold } = await supabase
      .from("cash_thresholds")
      .select("minimum_balance")
      .eq("connection_id", connectionId)
      .limit(1)
      .single();

    const thresholdAmount = threshold
      ? Number(threshold.minimum_balance)
      : null;

    // Find first threshold breach date
    let thresholdBreachDate: string | null = null;
    if (thresholdAmount !== null) {
      const breachPeriod = periods.find(
        (p) => p.closing < thresholdAmount
      );
      thresholdBreachDate = breachPeriod?.date || null;
    }

    const response: ForecastResponse = {
      currentBalance: Math.round(currentBalance * 100) / 100,
      fallsBelowZeroIn,
      periods,
      threshold: thresholdAmount,
      thresholdBreachDate,
    };

    return json(response);
  } catch (err) {
    return handleError(err);
  }
}
