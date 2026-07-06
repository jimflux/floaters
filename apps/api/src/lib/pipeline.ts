// Shared shapes and helpers for the income pipeline (projections, review,
// layered cashflow). Remainder semantics live here so the pipeline endpoint
// and the cashflow route can never drift apart.

export type ProjectionRow = {
  id: string;
  client_label: string;
  contact_id: string | null;
  amount: number | string;
  expected_month: string;
  created_at: string;
  updated_at: string;
};

export function projectionToApi(row: ProjectionRow) {
  return {
    id: row.id,
    clientLabel: row.client_label,
    contactId: row.contact_id,
    amount: Number(row.amount),
    expectedMonth: row.expected_month,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
