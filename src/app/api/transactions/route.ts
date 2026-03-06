import { supabase } from "@/lib/supabase";
import { requireConnection, json, handleError } from "@/lib/api-helpers";
import { NextRequest } from "next/server";
import type { TransactionsResponse } from "@/types/api";

export async function GET(request: NextRequest) {
  try {
    const connectionId = await requireConnection();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type"); // ACCREC or ACCPAY
    const status = searchParams.get("status");

    let query = supabase
      .from("xero_invoices")
      .select("*")
      .eq("connection_id", connectionId)
      .order("due_date", { ascending: true });

    if (type) {
      query = query.eq("type", type);
    }
    if (status) {
      query = query.eq("status", status);
    } else {
      query = query.in("status", ["AUTHORISED", "SUBMITTED", "DRAFT"]);
    }

    const { data: invoices } = await query;

    const response: TransactionsResponse = {
      transactions: (invoices || []).map((inv) => ({
        id: inv.id,
        type: inv.type,
        contactName: inv.contact_name,
        status: inv.status,
        total: Number(inv.total),
        amountDue: Number(inv.amount_due),
        dueDate: inv.due_date,
        expectedPaymentDate: inv.expected_payment_date,
        issueDate: inv.issue_date,
      })),
    };

    return json(response);
  } catch (err) {
    return handleError(err);
  }
}
