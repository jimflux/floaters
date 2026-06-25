// Shared API contract between the API, web, and MCP server.
// The canonical source of truth for the cashflow response shape.

export interface CashflowAccount {
  accountCode: string;
  accountName: string;
  monthly: number[]; // one per month, same order as months[]
  isProjected: boolean[]; // true if the month is a projection
  hasOverride: boolean[]; // true if the month has a manual projection override
}

export interface CashflowAccountInfo {
  code: string;
  name: string;
  type: string; // REVENUE, SALES, DIRECTCOSTS, OVERHEADS, EXPENSE, FIXEDASSET, CURRENTLIABILITY
  section: "income" | "costs";
  hidden: boolean;
}

// GET /api/cashflow — the API calls this CashflowResponse, the web calls it CashflowData.
export interface CashflowResponse {
  currentBalance: number;
  fallsBelowZeroIn: string | null;
  currentMonthIndex: number;
  months: string[]; // ["2025-12", "2026-01", ...]
  cashIn: CashflowAccount[];
  cashOut: CashflowAccount[];
  openingBalance: number[];
  closingBalance: number[];
  netCashMovement: number[];
  accounts: CashflowAccountInfo[];
}

// Alias kept for the web app's existing imports.
export type CashflowData = CashflowResponse;

export interface AccountGroup {
  id: string;
  name: string;
  accountCodes: string[];
  color: string | null;
  createdAt?: string;
}

// GET /api/projection-overrides
export interface ProjectionOverride {
  accountCode: string;
  month: string; // "2026-04"
  amount: number;
}

export interface ProjectionOverridesResponse {
  overrides: ProjectionOverride[];
}

// Generic API error
export interface ApiError {
  error: string;
  details?: string;
}
