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
  vatable?: boolean; // resolved VATable status (present only when VAT is enabled)
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
  // VAT (present only when VAT is enabled). The VAT quarterly bill also appears
  // as a display-only cost row in cashOut with accountCode "VAT_LIABILITY".
  vatAdjustedClosing?: number[]; // committed closing minus VAT owed; true spendable cash
  vatOwedNow?: number; // output VAT accrued on issued invoices this quarter, not yet paid
  vatProjectedBill?: number[]; // issued + projected VAT bill per month; the VAT cost row uses this on the projected view
  vatCurrentQuarter?: { key: string; paid: boolean }; // open quarter-end key + whether marked paid
}

// One month of a (possibly recurring) projection, expanded at read time.
export interface ProjectionOccurrence {
  month: string; // yyyy-MM
  amount: number; // escalated amount for this occurrence
  consumed: number; // assigned invoice totals attributed to this month
  remainder: number; // amount minus consumed, floor 0
  lapsed: boolean; // month passed with remainder > 0
}

// GET /api/pipeline — item-level view for the review tray, the projections
// manager, and agent consumers.
export interface PipelineProjection {
  id: string;
  clientKey: string;
  clientLabel: string;
  contactId: string | null;
  amount: number; // VAT-inclusive, per occurrence (the base amount)
  expectedMonth: string; // yyyy-MM, the first/start occurrence
  // Recurrence: recurrenceCount monthly occurrences from expectedMonth,
  // stepping up escalationPct every escalationEvery occurrences (compounding).
  recurrenceCount: number; // 1 = single-shot
  escalationPct: number; // 0 = flat
  escalationEvery: number | null; // occurrences per step; null = no escalation
  occurrences: ProjectionOccurrence[]; // one per month of the series
  remainder: number; // Σ occurrence remainders across the series
  consumed: number; // Σ assigned invoice totals (excl. VOIDED/DELETED); > total means over-assigned
  lapsed: boolean; // any occurrence's month passed with remainder > 0
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

// --- Time tracking (Toggl) ---
// Hours are context for the cashflow, never cash: nothing here feeds either
// balance walk. Rolled up by Toggl client, with an optional link to the income
// pipeline's clientKey so hours can sit next to what was invoiced.

export interface TimeProject {
  togglProjectId: number;
  name: string;
  billable: boolean;
  rate: number | null; // Toggl hourly rate when set
  currency: string | null;
  color: string | null;
  active: boolean;
  hours: number[]; // one per month, same order as months[]
  billableHours: number[];
}

export interface TimeClient {
  togglClientId: number | null; // null = entries with no client (no project, or a project without one)
  clientName: string;
  clientKey: string | null; // linked pipeline client key (same key space as IncomeClient.clientKey)
  linkSource: "manual" | "auto" | null; // explicit link, matched by name, or unlinked
  hours: number[];
  billableHours: number[];
  // Σ ACCREC invoice totals ex VAT by issue month for the linked pipeline
  // client; present only when linked. Divide by hours for an effective rate.
  invoicedExVat?: number[];
  projects: TimeProject[];
}

export interface RunningTimeEntry {
  togglId: number;
  description: string | null;
  projectName: string | null;
  clientName: string | null;
  startedAt: string; // ISO
  billable: boolean;
}

// GET /api/time
export interface TimeTrackingResponse {
  configured: boolean; // TOGGL_API_TOKEN present on the API
  lastSyncedAt: string | null;
  syncStatus: "idle" | "syncing" | "error";
  syncError: string | null;
  timeZone: string; // the zone entries are bucketed into days/months by
  months: string[]; // same window as the cashflow grid; future months are zero
  currentMonthIndex: number;
  clients: TimeClient[];
  totals: { hours: number[]; billableHours: number[] };
  todayHours: number;
  weekHours: number; // Monday-to-date in timeZone
  running: RunningTimeEntry | null;
  // Pipeline clients a Toggl client can be linked to (for the link picker).
  linkOptions: Array<{ clientKey: string; clientName: string }>;
}

// GET /api/time/entries
export interface TimeEntry {
  togglId: number;
  description: string | null;
  projectName: string | null;
  clientName: string | null;
  clientKey: string | null;
  start: string;
  stop: string | null;
  durationSeconds: number; // live for a running entry
  hours: number;
  billable: boolean;
  tags: string[];
  running: boolean;
}

export interface TimeEntriesResponse {
  from: string; // yyyy-MM-dd inclusive
  to: string; // yyyy-MM-dd inclusive
  timeZone: string;
  entries: TimeEntry[];
  totalHours: number;
  billableHours: number;
}
