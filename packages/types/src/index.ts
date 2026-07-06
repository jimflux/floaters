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

// Income is a pipeline of items rolled up by client, not account rows.
// Three layers per client: paid (cash received), invoiced (promises,
// remaining amount_due), projected (unfulfilled projection remainders).
export interface IncomeClient {
  clientKey: string; // explicit rollup key: "contact:<id>" | "label:<normalised>" | "UNASSIGNED"
  clientName: string; // display only, never a key
  monthly: number[]; // paid + invoiced + projected per month (grid client row)
  paid: number[];
  invoiced: number[];
  projected: number[];
  overdue: boolean[]; // month's invoiced layer contains an overdue invoice
}

export interface IncomeSection {
  clients: IncomeClient[];
  totals: {
    paid: number[];
    invoiced: number[];
    projected: number[];
  };
}

// GET /api/cashflow — the API calls this CashflowResponse, the web calls it CashflowData.
// Two balance walks: committed (cash + invoices sent + cost forecasts) is the
// headline and never includes hope; optimistic adds unfulfilled projection
// remainders. Both are identical over history.
export interface CashflowResponse {
  currentBalance: number;
  fallsBelowZeroIn: string | null; // committed; format string-matched by the web
  optimisticFallsBelowZeroIn: string | null;
  currentMonthIndex: number;
  months: string[]; // ["2025-12", "2026-01", ...]
  income: IncomeSection;
  cashOut: CashflowAccount[]; // costs keep the account model
  committedOpening: number[];
  committedClosing: number[];
  committedNet: number[];
  optimisticClosing: number[];
  optimisticNet: number[];
  accounts: CashflowAccountInfo[];
}

// GET /api/pipeline — item-level view for the review tray, the projections
// manager, and agent consumers.
export interface PipelineProjection {
  id: string;
  clientKey: string;
  clientLabel: string;
  contactId: string | null;
  amount: number; // VAT-inclusive
  expectedMonth: string; // yyyy-MM
  remainder: number; // amount minus consumed, floor 0
  consumed: number; // Σ assigned invoice totals (excl. VOIDED/DELETED); > amount means over-assigned
  lapsed: boolean; // expected month passed with remainder > 0 (derived)
  invoiceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PipelineInvoice {
  id: string;
  xeroId: string;
  contactId: string | null;
  contactName: string | null;
  clientKey: string;
  status: string | null;
  total: number;
  amountDue: number;
  issueDate: string | null;
  dueDate: string | null;
  expectedPaymentDate: string | null;
  overdue: boolean;
}

export interface PipelineResponse {
  currentMonth: string;
  projections: PipelineProjection[];
  unreviewed: PipelineInvoice[];
  contacts: Array<{ contactId: string; name: string | null }>;
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
