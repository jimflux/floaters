import { requireConnection, json, error, handleError } from "@/lib/api-helpers";
import { getDayTransactions } from "@/lib/forecast/engine";
import { NextRequest } from "next/server";
import type { ForecastTransactionsResponse } from "@/types/api";

export async function GET(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return error("date query param required (YYYY-MM-DD)", 400);
    }

    const scenarioParam = searchParams.get("scenarios");
    const scenarioIds = scenarioParam
      ? scenarioParam.split(",").filter(Boolean)
      : undefined;

    const transactions = await getDayTransactions(
      connectionId,
      date,
      scenarioIds
    );

    const response: ForecastTransactionsResponse = {
      date,
      transactions,
    };

    return json(response);
  } catch (err) {
    return handleError(err);
  }
}
