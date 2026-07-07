import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import PipelinePanel, { attentionCount } from "./PipelinePanel";
import type { PipelineResponse } from "@/lib/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const reviewInvoice = vi.fn();
const createProjection = vi.fn();
const updateProjection = vi.fn();
const deleteProjection = vi.fn();
vi.mock("@/lib/api", () => ({
  reviewInvoice: (...args: unknown[]) => reviewInvoice(...args),
  createProjection: (...args: unknown[]) => createProjection(...args),
  updateProjection: (...args: unknown[]) => updateProjection(...args),
  deleteProjection: (...args: unknown[]) => deleteProjection(...args),
}));

// Radix Sheet needs these in jsdom.
beforeEach(() => {
  reviewInvoice.mockReset().mockResolvedValue(undefined);
  createProjection.mockReset().mockResolvedValue(undefined);
  updateProjection.mockReset().mockResolvedValue(undefined);
  deleteProjection.mockReset().mockResolvedValue(undefined);
});

function pipeline(overrides: Partial<PipelineResponse> = {}): PipelineResponse {
  return {
    currentMonth: "2026-06",
    projections: [
      {
        id: "p1",
        clientKey: "contact:c-ikea",
        clientLabel: "IKEA",
        contactId: "c-ikea",
        amount: 45000,
        expectedMonth: "2026-07",
        recurrenceCount: 1,
        escalationPct: 0,
        escalationEvery: null,
        occurrences: [],
        remainder: 25000,
        consumed: 20000,
        lapsed: false,
        invoiceIds: ["x1"],
        createdAt: "",
        updatedAt: "",
      },
      {
        id: "p2",
        clientKey: "label:ghost co",
        clientLabel: "Ghost Co",
        contactId: null,
        amount: 21000,
        expectedMonth: "2026-04",
        recurrenceCount: 1,
        escalationPct: 0,
        escalationEvery: null,
        occurrences: [],
        remainder: 21000,
        consumed: 0,
        lapsed: true,
        invoiceIds: [],
        createdAt: "",
        updatedAt: "",
      },
    ],
    unreviewed: [
      {
        id: "inv-1",
        xeroId: "x-inv-1",
        contactId: "c-ikea",
        contactName: "IKEA",
        clientKey: "contact:c-ikea",
        status: "AUTHORISED",
        total: 5000,
        amountDue: 5000,
        issueDate: "2026-06-01",
        dueDate: "2026-07-01",
        expectedPaymentDate: null,
        overdue: false,
      },
      {
        id: "inv-2",
        xeroId: "x-inv-2",
        contactId: "c-acme",
        contactName: "Acme",
        clientKey: "contact:c-acme",
        status: "SUBMITTED",
        total: 800,
        amountDue: 800,
        issueDate: "2026-05-01",
        dueDate: "2026-05-20",
        expectedPaymentDate: null,
        overdue: true,
      },
    ],
    contacts: [
      { contactId: "c-ikea", name: "IKEA" },
      { contactId: "c-acme", name: "Acme" },
    ],
    ...overrides,
  };
}

function renderPanel(qc: QueryClient, data: PipelineResponse | undefined = pipeline()) {
  qc.setQueryData(["pipeline"], data);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return render(
    <PipelinePanel open onOpenChange={vi.fn()} pipeline={data} />,
    { wrapper }
  );
}

const qcFactory = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("attentionCount", () => {
  it("counts unreviewed invoices plus lapsed projections", () => {
    expect(attentionCount(pipeline())).toBe(3); // 2 unreviewed + 1 lapsed
    expect(attentionCount(undefined)).toBe(0);
  });
});

describe("review tray", () => {
  it("assign calls the adjustments endpoint and optimistically clears the row (F1)", async () => {
    const qc = qcFactory();
    renderPanel(qc);

    // Open the assign picker on the IKEA invoice and pick the IKEA projection.
    fireEvent.click(screen.getAllByText("Assign")[0]);
    const option = await screen.findByText("IKEA", { selector: "[cmdk-item] *" });
    fireEvent.click(option);

    await waitFor(() =>
      expect(reviewInvoice).toHaveBeenCalledWith("inv-1", { projectionId: "p1" })
    );
    const cached = qc.getQueryData<PipelineResponse>(["pipeline"])!;
    expect(cached.unreviewed.map(i => i.id)).toEqual(["inv-2"]);
  });

  it("failed assign restores the row and shows an error toast (D4)", async () => {
    reviewInvoice.mockRejectedValueOnce(new Error("boom"));
    const { toast } = await import("sonner");
    const qc = qcFactory();
    renderPanel(qc);

    fireEvent.click(screen.getAllByText("Assign")[0]);
    const option = await screen.findByText("IKEA", { selector: "[cmdk-item] *" });
    fireEvent.click(option);

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const cached = qc.getQueryData<PipelineResponse>(["pipeline"])!;
    expect(cached.unreviewed).toHaveLength(2); // rolled back
  });

  it("approve stamps review without a projection", async () => {
    const qc = qcFactory();
    renderPanel(qc);

    fireEvent.click(screen.getAllByText("Approve")[0]);
    await waitFor(() =>
      expect(reviewInvoice).toHaveBeenCalledWith("inv-1", { reviewed: true })
    );
  });

  it("bulk approve: select all, confirm, one call per invoice (D7)", async () => {
    const qc = qcFactory();
    renderPanel(qc);

    fireEvent.click(screen.getByLabelText("Select all"));
    fireEvent.click(screen.getByText("Approve selected (2)"));
    // Confirmation dialog
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByText("Approve"));

    await waitFor(() => expect(reviewInvoice).toHaveBeenCalledTimes(2));
    expect(reviewInvoice).toHaveBeenCalledWith("inv-1", { reviewed: true });
    expect(reviewInvoice).toHaveBeenCalledWith("inv-2", { reviewed: true });
  });

  it("renders the empty state with zero items (D5)", () => {
    const qc = qcFactory();
    renderPanel(qc, pipeline({ unreviewed: [], projections: [], contacts: [] }));
    expect(screen.getByText(/Nothing to review/)).toBeInTheDocument();
  });
});

describe("projections manager", () => {
  it("groups lapsed projections at the top and re-dates via the month editor", async () => {
    const qc = qcFactory();
    renderPanel(qc);

    fireEvent.mouseDown(screen.getByText("Projections"));
    expect(await screen.findByText(/Lapsed, re-date or delete/)).toBeInTheDocument();
    expect(screen.getByText("Ghost Co")).toBeInTheDocument();

    // Re-date Ghost Co (first row in the lapsed group)
    fireEvent.click(screen.getAllByTitle("Re-date")[0]);
    const monthInput = await screen.findByDisplayValue("2026-04");
    fireEvent.change(monthInput, { target: { value: "2026-08" } });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() =>
      expect(updateProjection).toHaveBeenCalledWith("p2", { expectedMonth: "2026-08" })
    );
  });

  it("delete asks for confirmation and fires the delete", async () => {
    const qc = qcFactory();
    renderPanel(qc);

    fireEvent.mouseDown(screen.getByText("Projections"));
    fireEvent.click((await screen.findAllByTitle("Delete"))[0]);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByText("Delete"));

    await waitFor(() => expect(deleteProjection).toHaveBeenCalled());
  });

  it("shows the over-assigned tag when consumed exceeds the amount (D8)", async () => {
    const data = pipeline();
    data.projections[0].consumed = 50000;
    data.projections[0].remainder = 0;
    const qc = qcFactory();
    renderPanel(qc, data);

    fireEvent.mouseDown(screen.getByText("Projections"));
    expect(await screen.findByText(/Over-assigned by £5,000/)).toBeInTheDocument();
  });

  it("create form rejects an empty amount and labels it inc VAT", async () => {
    const { toast } = await import("sonner");
    const qc = qcFactory();
    renderPanel(qc);

    fireEvent.mouseDown(screen.getByText("Projections"));
    expect(await screen.findByText("Amount (inc VAT)")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Add projection", { selector: "button" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(createProjection).not.toHaveBeenCalled();
  });

  it("creates a recurring projection with escalation from the form", async () => {
    const qc = qcFactory();
    renderPanel(qc);
    fireEvent.mouseDown(screen.getByText("Projections"));

    // Client via the picker's free-text input.
    fireEvent.click(await screen.findByText("Client…"));
    fireEvent.change(screen.getByPlaceholderText("Client name…"), { target: { value: "Retainer Co" } });

    fireEvent.click(screen.getByLabelText("Repeats monthly"));
    fireEvent.change(screen.getByLabelText("Amount (inc VAT)"), { target: { value: "10000" } });
    fireEvent.change(screen.getByLabelText("Start month"), { target: { value: "2026-08" } });
    fireEvent.change(screen.getByLabelText("For (months)"), { target: { value: "6" } });
    fireEvent.click(screen.getByLabelText("Step up over time"));
    fireEvent.change(screen.getByLabelText("Percent increase"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Occurrences per step"), { target: { value: "12" } });

    fireEvent.click(screen.getByText(/Add projection \(6 months\)/, { selector: "button" }));

    await waitFor(() => expect(createProjection).toHaveBeenCalled());
    expect(createProjection.mock.calls[0][0]).toEqual({
      clientLabel: "Retainer Co",
      amount: 10000,
      expectedMonth: "2026-08",
      contactId: null,
      recurrenceCount: 6,
      escalationPct: 5,
      escalationEvery: 12,
    });
  });

  it("renders the projections empty state (D5)", async () => {
    const qc = qcFactory();
    renderPanel(qc, pipeline({ unreviewed: [], projections: [] }));
    fireEvent.mouseDown(screen.getByText("Projections"));
    expect(await screen.findByText(/No projections yet/)).toBeInTheDocument();
  });
});
