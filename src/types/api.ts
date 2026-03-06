import type { ForecastPeriod, DayTransaction } from "./forecast";

// GET /api/connection
export interface ConnectionResponse {
  connected: boolean;
  tenantName: string | null;
  bankAccounts: {
    id: string;
    name: string;
    code: string;
    balance: number;
  }[];
  totalBalance: number;
}

// GET /api/sync-status
export interface SyncStatusResponse {
  status: "idle" | "syncing" | "error";
  lastSyncedAt: string | null;
  error: string | null;
  recordsSynced: number | null;
}

// GET /api/forecast
export interface ForecastResponse {
  currentBalance: number;
  fallsBelowZeroIn: string | null;
  periods: ForecastPeriod[];
  threshold: number | null;
  thresholdBreachDate: string | null;
}

// GET /api/forecast/transactions
export interface ForecastTransactionsResponse {
  date: string;
  transactions: DayTransaction[];
}

// GET /api/transactions
export interface TransactionsResponse {
  transactions: {
    id: string;
    type: "ACCREC" | "ACCPAY";
    contactName: string | null;
    status: string;
    total: number;
    amountDue: number;
    dueDate: string;
    expectedPaymentDate: string | null;
    issueDate: string;
  }[];
}

// Scenarios
export interface Scenario {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  items?: ScenarioItem[];
}

export interface ScenarioItem {
  id: string;
  type: "income" | "expense";
  description: string;
  amount: number;
  frequency: "once" | "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly";
  startDate: string;
  endDate: string | null;
}

// Budgets
export interface Budget {
  id: string;
  name: string;
  periodType: "monthly" | "weekly";
  createdAt: string;
  lines?: BudgetLine[];
}

export interface BudgetLine {
  id: string;
  category: string;
  type: "income" | "expense";
  amount: number;
  periodStart: string;
}

export interface BudgetComparisonResponse {
  periods: {
    periodStart: string;
    categories: {
      category: string;
      type: "income" | "expense";
      budgeted: number;
      actual: number;
      variance: number;
      variancePercent: number;
    }[];
  }[];
}

// Thresholds
export interface CashThreshold {
  id: string;
  minimumBalance: number;
  alertEmail: boolean;
}

// Account Groups
export interface AccountGroup {
  id: string;
  name: string;
  accountIds: string[];
  color: string | null;
}

// Generic API error
export interface ApiError {
  error: string;
  details?: string;
}
