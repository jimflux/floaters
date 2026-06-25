export interface ForecastPeriod {
  date: string;
  opening: number;
  inflows: number;
  outflows: number;
  closing: number;
  scenarioInflows?: number;
  scenarioOutflows?: number;
  scenarioClosing?: number;
}

export interface ForecastRequest {
  period: "daily" | "weekly" | "monthly";
  from: string;
  to: string;
  scenarios?: string[];
  accountGroup?: string;
}

export interface DayTransaction {
  id: string;
  type: "inflow" | "outflow";
  source: "invoice" | "bill" | "scenario";
  contactName: string | null;
  description: string;
  amount: number;
  date: string;
  status: string;
  expectedPaymentDate: string | null;
  scenarioName?: string;
}
