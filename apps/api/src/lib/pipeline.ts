// Shared shapes and helpers for the income pipeline (projections, review,
// layered cashflow). Remainder semantics live here so the pipeline endpoint
// and the cashflow route can never drift apart.

export type ProjectionRow = {
  id: string;
  client_label: string;
  contact_id: string | null;
  amount: number | string;
  expected_month: string;
  recurrence_count?: number | string | null;
  escalation_pct?: number | string | null;
  escalation_every?: number | string | null;
  created_at: string;
  updated_at: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Number of occurrences, floored at 1 (a legacy row with null reads as 1).
export function recurrenceCount(row: ProjectionRow): number {
  const n = Number(row.recurrence_count ?? 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export function projectionToApi(row: ProjectionRow) {
  const every = Number(row.escalation_every ?? 0);
  return {
    id: row.id,
    clientLabel: row.client_label,
    contactId: row.contact_id,
    amount: Number(row.amount),
    expectedMonth: row.expected_month,
    recurrenceCount: recurrenceCount(row),
    escalationPct: Number(row.escalation_pct ?? 0),
    escalationEvery: Number.isFinite(every) && every > 0 ? Math.floor(every) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Add n calendar months to a yyyy-MM key (pure, no Date, DST-safe).
export function addMonthKey(yyyymm: string, n: number): string {
  const [y, m] = yyyymm.split("-").map(Number);
  const zero = y * 12 + (m - 1) + n;
  const year = Math.floor(zero / 12);
  const month = (zero % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

// The escalated amount for occurrence `index` (0-based): base stepped up by
// escalationPct every escalationEvery occurrences, compounding per block.
export function occurrenceAmount(
  base: number,
  index: number,
  escalationPct: number,
  escalationEvery: number | null
): number {
  if (!escalationEvery || escalationEvery <= 0 || !escalationPct) return round2(base);
  const block = Math.floor(index / escalationEvery);
  return round2(base * Math.pow(1 + escalationPct / 100, block));
}

// Statuses whose totals never count against a projection's remainder (R14).
const DEAD_STATUSES = new Set(["VOIDED", "DELETED"]);

/**
 * R14: Σ assigned invoices' total (VAT-inclusive), excluding VOIDED/DELETED.
 * Exposed separately so over-assignment (consumed > amount) stays visible
 * even though the remainder floors at zero.
 */
export function projectionConsumed(
  assigned: Array<{ status: string | null; total: number | string | null }>
): number {
  const consumed = assigned.reduce((sum, inv) => {
    if (inv.status && DEAD_STATUSES.has(inv.status)) return sum;
    return sum + Number(inv.total ?? 0);
  }, 0);
  return Math.round(consumed * 100) / 100;
}

/**
 * R14: remainder = amount − consumed, floored at zero.
 */
export function projectionRemainder(
  amount: number,
  assigned: Array<{ status: string | null; total: number | string | null }>
): number {
  return Math.max(
    0,
    Math.round((amount - projectionConsumed(assigned)) * 100) / 100
  );
}

/**
 * R5/R18: lapsed = expected_month strictly before the current month with
 * remainder still above zero. Fully consumed projections are neither
 * projected nor lapsed. Derived at read time, never stored.
 */
export function isLapsed(
  expectedMonth: string,
  currentMonth: string,
  remainder: number
): boolean {
  return expectedMonth < currentMonth && remainder > 0;
}

// The grid month an invoice buckets into: expected payment date over due date,
// floored to the current month (overdue rolls forward). The single rule shared
// by the cashflow invoiced layer and recurring-projection consumption.
export function invoiceBucketMonth(
  expectedPaymentDate: string | null,
  dueDate: string | null,
  currentMonth: string
): string | null {
  const raw = expectedPaymentDate || dueDate;
  if (!raw) return null;
  const month = raw.slice(0, 7);
  return month < currentMonth ? currentMonth : month;
}

export type AssignedInvoice = {
  status: string | null;
  total: number | string | null;
  // Grid month the invoice buckets into (expected/due, floored to current).
  // Used to attribute consumption to the matching occurrence of a recurring
  // projection. Ignored when the projection has a single occurrence.
  bucketMonth?: string | null;
};

export type Occurrence = {
  month: string;
  amount: number;
  consumed: number;
  remainder: number;
  lapsed: boolean;
};

/**
 * Expand a projection into its monthly occurrences with per-occurrence
 * consumption, remainder and lapse. This is the single source of truth both
 * the pipeline endpoint and the cashflow route expand through, so recurrence
 * semantics can never drift between them.
 *
 * Consumption:
 * - Single occurrence (legacy / non-recurring): every live assigned invoice
 *   consumes it, regardless of the invoice's month — preserves the original
 *   behaviour exactly.
 * - Multiple occurrences: each invoice consumes the occurrence whose month
 *   matches its bucketMonth. An assigned invoice outside the series still
 *   counts toward consumedTotal (so over-assignment stays visible) but does
 *   not reduce any occurrence's projected remainder.
 */
export function expandProjection(
  row: ProjectionRow,
  assigned: AssignedInvoice[],
  currentMonth: string
): {
  occurrences: Occurrence[];
  amountTotal: number;
  consumedTotal: number;
  remainderTotal: number;
  lapsed: boolean;
} {
  const base = Number(row.amount);
  const count = recurrenceCount(row);
  const pct = Number(row.escalation_pct ?? 0);
  const everyRaw = Number(row.escalation_every ?? 0);
  const every = Number.isFinite(everyRaw) && everyRaw > 0 ? Math.floor(everyRaw) : null;

  const live = assigned.filter((inv) => !(inv.status && DEAD_STATUSES.has(inv.status)));
  const consumedTotal = round2(live.reduce((s, inv) => s + Number(inv.total ?? 0), 0));

  const months: string[] = [];
  const amounts: number[] = [];
  for (let i = 0; i < count; i++) {
    months.push(addMonthKey(row.expected_month, i));
    amounts.push(occurrenceAmount(base, i, pct, every));
  }

  // Consumption per occurrence month.
  const consumedByMonth = new Map<string, number>();
  if (count === 1) {
    consumedByMonth.set(months[0], consumedTotal);
  } else {
    for (const inv of live) {
      if (!inv.bucketMonth) continue;
      consumedByMonth.set(
        inv.bucketMonth,
        (consumedByMonth.get(inv.bucketMonth) ?? 0) + Number(inv.total ?? 0)
      );
    }
  }

  const occurrences: Occurrence[] = months.map((month, i) => {
    const consumed = round2(consumedByMonth.get(month) ?? 0);
    const remainder = Math.max(0, round2(amounts[i] - consumed));
    return {
      month,
      amount: amounts[i],
      consumed,
      remainder,
      lapsed: month < currentMonth && remainder > 0,
    };
  });

  return {
    occurrences,
    amountTotal: round2(amounts.reduce((s, a) => s + a, 0)),
    consumedTotal,
    remainderTotal: round2(occurrences.reduce((s, o) => s + o.remainder, 0)),
    lapsed: occurrences.some((o) => o.lapsed),
  };
}

/**
 * R15: client rollup key precedence — contact_id, else normalised label,
 * else UNASSIGNED. Keys are explicit in API responses; display names come
 * from invoices, never from the key.
 */
export function clientKey(
  contactId: string | null | undefined,
  label?: string | null
): string {
  if (contactId) return `contact:${contactId}`;
  const normalised = (label ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return normalised ? `label:${normalised}` : "UNASSIGNED";
}
