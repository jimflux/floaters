import { supabase } from "@/lib/supabase";
import {
  addDays,
  startOfWeek,
  startOfMonth,
  format,
  isWithinInterval,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
  parseISO,
  addWeeks,
  addMonths,
  addYears,
  isBefore,
  isAfter,
} from "date-fns";
import type { ForecastPeriod, DayTransaction } from "@/types/forecast";

interface ScenarioItemRow {
  id: string;
  type: "income" | "expense";
  description: string;
  amount: number;
  frequency: string;
  start_date: string;
  end_date: string | null;
  scenario_name: string;
}

export async function computeForecast(
  connectionId: string,
  period: "daily" | "weekly" | "monthly",
  from: string,
  to: string,
  scenarioIds?: string[]
): Promise<ForecastPeriod[]> {
  const fromDate = parseISO(from);
  const toDate = parseISO(to);

  // 1. Get current bank balance as starting point
  const { data: bankAccounts } = await supabase
    .from("xero_accounts")
    .select("current_balance")
    .eq("connection_id", connectionId)
    .eq("type", "BANK");

  const startingBalance = (bankAccounts || []).reduce(
    (sum, a) => sum + (Number(a.current_balance) || 0),
    0
  );

  // 2. Get outstanding invoices (inflows)
  const { data: invoices } = await supabase
    .from("xero_invoices")
    .select("*")
    .eq("connection_id", connectionId)
    .eq("type", "ACCREC")
    .in("status", ["AUTHORISED", "SUBMITTED"]);

  // 3. Get outstanding bills (outflows)
  const { data: bills } = await supabase
    .from("xero_invoices")
    .select("*")
    .eq("connection_id", connectionId)
    .eq("type", "ACCPAY")
    .in("status", ["AUTHORISED", "SUBMITTED"]);

  // 4. Get scenario items if requested
  let scenarioItems: ScenarioItemRow[] = [];
  if (scenarioIds && scenarioIds.length > 0) {
    const { data: items } = await supabase
      .from("scenario_items")
      .select("*, scenarios!inner(name, is_active)")
      .in("scenario_id", scenarioIds);

    scenarioItems = (items || []).map((item) => ({
      id: item.id,
      type: item.type,
      description: item.description,
      amount: Number(item.amount),
      frequency: item.frequency,
      start_date: item.start_date,
      end_date: item.end_date,
      scenario_name: (item as Record<string, unknown>).scenarios
        ? ((item as Record<string, unknown>).scenarios as { name: string }).name
        : "Scenario",
    }));
  }

  // 5. Build daily cash flow map
  const dailyFlows = new Map<
    string,
    { inflows: number; outflows: number; scenarioInflows: number; scenarioOutflows: number }
  >();

  const initDay = (date: string) => {
    if (!dailyFlows.has(date)) {
      dailyFlows.set(date, {
        inflows: 0,
        outflows: 0,
        scenarioInflows: 0,
        scenarioOutflows: 0,
      });
    }
    return dailyFlows.get(date)!;
  };

  // Add invoice inflows
  for (const inv of invoices || []) {
    const payDate = inv.expected_payment_date || inv.due_date;
    const day = initDay(payDate);
    day.inflows += Number(inv.amount_due);
  }

  // Add bill outflows
  for (const bill of bills || []) {
    const payDate = bill.expected_payment_date || bill.due_date;
    const day = initDay(payDate);
    day.outflows += Number(bill.amount_due);
  }

  // Add scenario items
  for (const item of scenarioItems) {
    const occurrences = getOccurrences(
      item.frequency,
      item.start_date,
      item.end_date,
      from,
      to
    );
    for (const date of occurrences) {
      const day = initDay(date);
      if (item.type === "income") {
        day.scenarioInflows += item.amount;
      } else {
        day.scenarioOutflows += item.amount;
      }
    }
  }

  // 6. Generate periods
  const periods: ForecastPeriod[] = [];
  let intervals: Date[];

  switch (period) {
    case "daily":
      intervals = eachDayOfInterval({ start: fromDate, end: toDate });
      break;
    case "weekly":
      intervals = eachWeekOfInterval(
        { start: fromDate, end: toDate },
        { weekStartsOn: 1 }
      );
      break;
    case "monthly":
      intervals = eachMonthOfInterval({ start: fromDate, end: toDate });
      break;
  }

  let runningBalance = startingBalance;
  let runningScenarioBalance = startingBalance;

  for (let i = 0; i < intervals.length; i++) {
    const periodStart = intervals[i];
    const periodEnd =
      i + 1 < intervals.length
        ? addDays(intervals[i + 1], -1)
        : toDate;

    // Sum all daily flows in this period
    let periodInflows = 0;
    let periodOutflows = 0;
    let periodScenarioInflows = 0;
    let periodScenarioOutflows = 0;

    const days = eachDayOfInterval({ start: periodStart, end: periodEnd });
    for (const day of days) {
      const dateStr = format(day, "yyyy-MM-dd");
      const flows = dailyFlows.get(dateStr);
      if (flows) {
        periodInflows += flows.inflows;
        periodOutflows += flows.outflows;
        periodScenarioInflows += flows.scenarioInflows;
        periodScenarioOutflows += flows.scenarioOutflows;
      }
    }

    const opening = runningBalance;
    const closing = opening + periodInflows - periodOutflows;
    runningBalance = closing;

    const scenarioOpening = runningScenarioBalance;
    const scenarioClosing =
      scenarioOpening +
      periodInflows +
      periodScenarioInflows -
      periodOutflows -
      periodScenarioOutflows;
    runningScenarioBalance = scenarioClosing;

    periods.push({
      date: format(periodStart, "yyyy-MM-dd"),
      opening: round(opening),
      inflows: round(periodInflows),
      outflows: round(periodOutflows),
      closing: round(closing),
      scenarioInflows:
        periodScenarioInflows > 0 ? round(periodScenarioInflows) : undefined,
      scenarioOutflows:
        periodScenarioOutflows > 0 ? round(periodScenarioOutflows) : undefined,
      scenarioClosing:
        periodScenarioInflows > 0 || periodScenarioOutflows > 0
          ? round(scenarioClosing)
          : undefined,
    });
  }

  return periods;
}

export async function getDayTransactions(
  connectionId: string,
  date: string,
  scenarioIds?: string[]
): Promise<DayTransaction[]> {
  const transactions: DayTransaction[] = [];

  // Invoices due on this date
  const { data: invoices } = await supabase
    .from("xero_invoices")
    .select("*")
    .eq("connection_id", connectionId)
    .eq("type", "ACCREC")
    .in("status", ["AUTHORISED", "SUBMITTED"])
    .or(`due_date.eq.${date},expected_payment_date.eq.${date}`);

  for (const inv of invoices || []) {
    transactions.push({
      id: inv.id,
      type: "inflow",
      source: "invoice",
      contactName: inv.contact_name,
      description: `Invoice from ${inv.contact_name || "Unknown"}`,
      amount: Number(inv.amount_due),
      date,
      status: inv.status,
      expectedPaymentDate: inv.expected_payment_date,
    });
  }

  // Bills due on this date
  const { data: bills } = await supabase
    .from("xero_invoices")
    .select("*")
    .eq("connection_id", connectionId)
    .eq("type", "ACCPAY")
    .in("status", ["AUTHORISED", "SUBMITTED"])
    .or(`due_date.eq.${date},expected_payment_date.eq.${date}`);

  for (const bill of bills || []) {
    transactions.push({
      id: bill.id,
      type: "outflow",
      source: "bill",
      contactName: bill.contact_name,
      description: `Bill to ${bill.contact_name || "Unknown"}`,
      amount: Number(bill.amount_due),
      date,
      status: bill.status,
      expectedPaymentDate: bill.expected_payment_date,
    });
  }

  // Scenario items
  if (scenarioIds && scenarioIds.length > 0) {
    const { data: items } = await supabase
      .from("scenario_items")
      .select("*, scenarios!inner(name)")
      .in("scenario_id", scenarioIds);

    for (const item of items || []) {
      const occurrences = getOccurrences(
        item.frequency,
        item.start_date,
        item.end_date,
        date,
        date
      );
      if (occurrences.includes(date)) {
        transactions.push({
          id: item.id,
          type: item.type === "income" ? "inflow" : "outflow",
          source: "scenario",
          contactName: null,
          description: item.description,
          amount: Number(item.amount),
          date,
          status: "scenario",
          expectedPaymentDate: null,
          scenarioName: (item as Record<string, unknown>).scenarios
            ? ((item as Record<string, unknown>).scenarios as { name: string }).name
            : "Scenario",
        });
      }
    }
  }

  return transactions;
}

function getOccurrences(
  frequency: string,
  startDate: string,
  endDate: string | null,
  rangeFrom: string,
  rangeTo: string
): string[] {
  const dates: string[] = [];
  let current = parseISO(startDate);
  const end = endDate ? parseISO(endDate) : parseISO(rangeTo);
  const rangeStart = parseISO(rangeFrom);
  const rangeEnd = parseISO(rangeTo);

  while (!isAfter(current, end) && !isAfter(current, rangeEnd)) {
    if (
      !isBefore(current, rangeStart) &&
      isWithinInterval(current, { start: rangeStart, end: rangeEnd })
    ) {
      dates.push(format(current, "yyyy-MM-dd"));
    }

    switch (frequency) {
      case "once":
        return dates;
      case "weekly":
        current = addWeeks(current, 1);
        break;
      case "fortnightly":
        current = addWeeks(current, 2);
        break;
      case "monthly":
        current = addMonths(current, 1);
        break;
      case "quarterly":
        current = addMonths(current, 3);
        break;
      case "yearly":
        current = addYears(current, 1);
        break;
      default:
        return dates;
    }
  }

  return dates;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
