import { supabase } from "@/lib/supabase";
import { requireConnection, json, handleError } from "@/lib/api-helpers";
import {
  projectionToApi,
  expandProjection,
  invoiceBucketMonth,
  clientKey,
  type ProjectionRow,
} from "@/lib/pipeline";
import { format, subDays } from "date-fns";

type InvoiceRow = {
  id: string;
  xero_id: string;
  projection_id: string | null;
  contact_id: string | null;
  contact_name: string | null;
  status: string | null;
  total: number | string | null;
  amount_due: number | string | null;
  issue_date: string | null;
  due_date: string | null;
  expected_payment_date: string | null;
  fully_paid_on_date: string | null;
  xero_updated_at: string | null;
};

const TRAY_OPEN_STATUSES = ["AUTHORISED", "SUBMITTED"];
const PAID_WINDOW_DAYS = 30;

export async function GET() {
  try {
    const connectionId = await requireConnection();
    const today = format(new Date(), "yyyy-MM-dd");
    const currentMonth = today.slice(0, 7);
    const paidCutoff = format(subDays(new Date(), PAID_WINDOW_DAYS), "yyyy-MM-dd");

    const [{ data: projectionRows }, { data: assignedRows }, { data: unreviewedRows }, { data: contactRows }] =
      await Promise.all([
        supabase
          .from("income_projections")
          .select("*")
          .eq("connection_id", connectionId)
          .order("expected_month", { ascending: true }),
        supabase
          .from("xero_invoices")
          .select("xero_id, projection_id, status, total, due_date, expected_payment_date")
          .eq("connection_id", connectionId)
          .not("projection_id", "is", null),
        // R17 tray filter: unreviewed ACCREC in AUTHORISED/SUBMITTED, or PAID
        // recently. DRAFT/ACCPAY/VOIDED/DELETED never. PAID rows count when
        // paid within the last 30 days OR when Xero left fully_paid_on_date
        // null (credit-note settlement, data gaps) — otherwise that cash could
        // never be assigned to its projection. The reviewed_at IS NULL filter
        // already bounds this to freshly-synced rows, so it can't flood.
        supabase
          .from("xero_invoices")
          .select(
            "id, xero_id, projection_id, contact_id, contact_name, status, total, amount_due, issue_date, due_date, expected_payment_date, fully_paid_on_date, xero_updated_at"
          )
          .eq("connection_id", connectionId)
          .eq("type", "ACCREC")
          .is("reviewed_at", null)
          .or(
            `status.in.(${TRAY_OPEN_STATUSES.join(",")}),and(status.eq.PAID,fully_paid_on_date.gte.${paidCutoff}),and(status.eq.PAID,fully_paid_on_date.is.null)`
          ),
        // Client picker source: contacts seen on ACCREC invoices, most recent first.
        supabase
          .from("xero_invoices")
          .select("contact_id, contact_name, xero_updated_at")
          .eq("connection_id", connectionId)
          .eq("type", "ACCREC")
          .not("contact_id", "is", null)
          .order("xero_updated_at", { ascending: false }),
      ]);

    const assignedByProjection = new Map<string, InvoiceRow[]>();
    for (const inv of (assignedRows as InvoiceRow[]) || []) {
      if (!inv.projection_id) continue;
      const list = assignedByProjection.get(inv.projection_id) || [];
      list.push(inv);
      assignedByProjection.set(inv.projection_id, list);
    }

    const projections = (((projectionRows as ProjectionRow[]) || [])).map((row) => {
      const assigned = assignedByProjection.get(row.id) || [];
      const exp = expandProjection(
        row,
        assigned.map((a) => ({
          status: a.status,
          total: a.total,
          bucketMonth: invoiceBucketMonth(a.expected_payment_date, a.due_date, currentMonth),
        })),
        currentMonth
      );
      return {
        ...projectionToApi(row),
        clientKey: clientKey(row.contact_id, row.client_label),
        remainder: exp.remainderTotal,
        consumed: exp.consumedTotal,
        lapsed: exp.lapsed,
        occurrences: exp.occurrences,
        invoiceIds: assigned.map((a) => a.xero_id),
      };
    });

    const unreviewed = (((unreviewedRows as InvoiceRow[]) || [])).map((inv) => {
      const paymentDue = inv.expected_payment_date || inv.due_date;
      return {
        id: inv.id,
        xeroId: inv.xero_id,
        contactId: inv.contact_id,
        contactName: inv.contact_name,
        clientKey: clientKey(inv.contact_id, inv.contact_name),
        status: inv.status,
        total: Number(inv.total ?? 0),
        amountDue: Number(inv.amount_due ?? 0),
        issueDate: inv.issue_date,
        dueDate: inv.due_date,
        expectedPaymentDate: inv.expected_payment_date,
        overdue:
          inv.status !== "PAID" && paymentDue !== null && paymentDue < today,
      };
    });

    const seen = new Set<string>();
    const contacts: Array<{ contactId: string; name: string | null }> = [];
    for (const c of ((contactRows as InvoiceRow[]) || [])) {
      if (!c.contact_id || seen.has(c.contact_id)) continue;
      seen.add(c.contact_id);
      contacts.push({ contactId: c.contact_id, name: c.contact_name });
    }

    return json({ currentMonth, projections, unreviewed, contacts });
  } catch (err) {
    return handleError(err);
  }
}
