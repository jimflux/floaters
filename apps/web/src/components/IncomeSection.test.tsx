import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import IncomeSection, { unreviewedByClientMonth } from "./IncomeSection";
import type { IncomeSection as IncomeSectionData, PipelineResponse } from "@/lib/types";

const months = ["2026-05", "2026-06", "2026-07"];

function fixture(): IncomeSectionData {
  return {
    clients: [
      {
        clientKey: "contact:c-ikea",
        clientName: "IKEA",
        monthly: [1000, 20000, 25000],
        paid: [1000, 0, 0],
        invoiced: [0, 20000, 0],
        projected: [0, 0, 25000],
        overdue: [false, true, false],
      },
      {
        clientKey: "UNASSIGNED",
        clientName: "Unassigned",
        monthly: [542, 0, 0],
        paid: [542, 0, 0],
        invoiced: [0, 0, 0],
        projected: [0, 0, 0],
        overdue: [false, false, false],
      },
    ],
    totals: {
      paid: [1542, 0, 0],
      invoiced: [0, 20000, 0],
      projected: [0, 0, 25000],
    },
  };
}

function renderSection(income: IncomeSectionData, unreviewed = new Map<string, Set<string>>()) {
  return render(
    <table>
      <tbody>
        <IncomeSection
          income={income}
          months={months}
          currentMonthIndex={1}
          open
          onToggle={vi.fn()}
          onAddProjection={vi.fn()}
          unreviewed={unreviewed}
        />
      </tbody>
    </table>
  );
}

describe("IncomeSection", () => {
  it("renders three layer subtotal rows and client rows from the fixture", () => {
    renderSection(fixture());
    expect(screen.getByTestId("layer-paid")).toHaveTextContent("£1,542");
    expect(screen.getByTestId("layer-invoiced")).toHaveTextContent("£20,000");
    expect(screen.getByTestId("layer-projected")).toHaveTextContent("£25,000");
    expect(screen.getByText("IKEA")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("renders a single summed figure per client-month cell (micro-layout)", () => {
    renderSection(fixture());
    const ikeaRow = screen.getByText("IKEA").closest("tr")!;
    const cells = ikeaRow.querySelectorAll("td");
    // label + 3 months; each month cell holds exactly one figure
    expect(cells[2].textContent).toBe("£20,000");
    expect(cells[3].textContent).toBe("£25,000");
  });

  it("shows the overdue dot from the response and the unreviewed dot from the pipeline join", () => {
    const unreviewed = new Map([["contact:c-ikea", new Set(["2026-06"])]]);
    renderSection(fixture(), unreviewed);
    expect(screen.getByTestId("overdue-dot")).toBeInTheDocument();
    expect(screen.getByTestId("unreviewed-dot")).toBeInTheDocument();
  });

  it("renders the empty state without error when there are no clients", () => {
    renderSection({ clients: [], totals: { paid: [0, 0, 0], invoiced: [0, 0, 0], projected: [0, 0, 0] } });
    expect(screen.getByText(/No income yet/)).toBeInTheDocument();
  });
});

describe("unreviewedByClientMonth", () => {
  it("floors overdue unreviewed invoices to the current month and skips PAID rows", () => {
    const pipeline = {
      currentMonth: "2026-06",
      projections: [],
      contacts: [],
      unreviewed: [
        { id: "1", xeroId: "x1", contactId: "c1", contactName: "A", clientKey: "contact:c1", status: "AUTHORISED", total: 1, amountDue: 1, issueDate: null, dueDate: "2026-03-01", expectedPaymentDate: null, overdue: true },
        { id: "2", xeroId: "x2", contactId: "c1", contactName: "A", clientKey: "contact:c1", status: "SUBMITTED", total: 1, amountDue: 1, issueDate: null, dueDate: "2026-07-01", expectedPaymentDate: null, overdue: false },
        { id: "3", xeroId: "x3", contactId: "c2", contactName: "B", clientKey: "contact:c2", status: "PAID", total: 1, amountDue: 0, issueDate: null, dueDate: "2026-06-01", expectedPaymentDate: null, overdue: false },
      ],
    } as unknown as PipelineResponse;
    const map = unreviewedByClientMonth(pipeline, "2026-06");
    expect(map.get("contact:c1")).toEqual(new Set(["2026-06", "2026-07"]));
    expect(map.has("contact:c2")).toBe(false);
  });
});
