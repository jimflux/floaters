import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { computeForecast } from "@/lib/forecast/engine";
import { supabase } from "@/lib/supabase";
import { NextRequest } from "next/server";
import { format, addDays, addMonths, addYears } from "date-fns";
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

    const periods = await computeForecast(
      connectionId,
      period,
      from,
      to,
      scenarioIds
    );

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

    // Find first breach date
    let thresholdBreachDate: string | null = null;
    if (thresholdAmount !== null) {
      const breachPeriod = periods.find(
        (p) => p.closing < thresholdAmount
      );
      thresholdBreachDate = breachPeriod?.date || null;
    }

    const response: ForecastResponse = {
      periods,
      threshold: thresholdAmount,
      thresholdBreachDate,
    };

    return json(response);
  } catch (err) {
    return handleError(err);
  }
}
