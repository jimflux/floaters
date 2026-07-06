import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CashflowMobile from "./CashflowMobile";
import type { CashflowData } from "@/lib/types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  triggerSync: vi.fn().mockResolvedValue(undefined),
  getPipeline: vi.fn().mockResolvedValue({ currentMonth: "2026-06", projections: [], unreviewed: [], contacts: [] }),
  setProjectionOverride: vi.fn().mockResolvedValue(undefined),
  removeProjectionOverride: vi.fn().mockResolvedValue(undefined),
  createProjection: vi.fn().mockResolvedValue(undefined),
  updateProjection: vi.fn().mockResolvedValue(undefined),
  deleteProjection: vi.fn().mockResolvedValue(undefined),
  reviewInvoice: vi.fn().mockResolvedValue(undefined),
}));

function fixture(): CashflowData {
  return {
    currentBalance: 10000,
    fallsBelowZeroIn: null,
    optimisticFallsBelowZeroIn: null,
    currentMonthIndex: 1,
    months: ["2026-05", "2026-06", "2026-07"],
    income: {
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
      ],
      totals: {
        paid: [1000, 0, 0],
        invoiced: [0, 20000, 0],
        projected: [0, 0, 25000],
      },
    },
    cashOut: [
      {
        accountCode: "400",
        accountName: "Advertising",
        monthly: [900, 900, 900],
        isProjected: [false, true, true],
        hasOverride: [false, false, false],
      },
    ],
    committedOpening: [9000, 10000, 29100],
    committedClosing: [10000, 29100, 28200],
    committedNet: [100, 19100, -900],
    optimisticClosing: [10000, 29100, 53200],
    optimisticNet: [100, 19100, 24100],
    accounts: [],
  };
}

function renderMobile(data: CashflowData = fixture()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CashflowMobile data={data} />
    </QueryClientProvider>
  );
}

describe("CashflowMobile on the layered shape", () => {
  it("renders the current month with layer subtotals matching the fixture", () => {
    renderMobile();
    // Current month (June, index 1)
    expect(screen.getByText("June 2026")).toBeInTheDocument();
    expect(screen.getByTestId("m-layer-paid")).toHaveTextContent("£0");
    expect(screen.getByTestId("m-layer-invoiced")).toHaveTextContent("£20,000");
    expect(screen.getByTestId("m-layer-projected")).toHaveTextContent("£0");
    // Income section total = sum of layers for the month
    expect(screen.getByText("↗ Income").closest("button")).toHaveTextContent("£20,000");
  });

  it("shows client rows when expanded; they are plain text, not editable", () => {
    renderMobile();
    fireEvent.click(screen.getByText(/By client \(1\)/));
    const ikea = screen.getByText("IKEA");
    expect(ikea).toBeInTheDocument();
    // No editor popover trigger on income rows (EditableCell renders a button)
    expect(ikea.closest("div")!.querySelector("button")).toBeNull();
  });

  it("keeps cost rows editable", async () => {
    renderMobile();
    // The cost row renders an EditableCell trigger button with the value
    const advertising = screen.getByText("Advertising");
    const row = advertising.closest("div")!.parentElement!;
    expect(row.querySelector("button")).not.toBeNull();
  });

  it("renders committed balances in the summary rows", () => {
    renderMobile();
    expect(screen.getByText("Opening balance").parentElement).toHaveTextContent("£10,000");
    expect(screen.getByText("Ending balance").parentElement).toHaveTextContent("£29,100");
  });
});
